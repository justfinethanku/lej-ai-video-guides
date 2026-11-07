"""Exercise the actual Resolve CLI main with a synthetic SDK, not a live GPU/editor."""
import hashlib
import importlib.util
import json
import os
import subprocess
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
SOURCE = Path(os.environ.get("GUIDES_RESOLVE_SOURCE", SCRIPTS / "resolve_build.py"))


class Folder:
    def __init__(self, name): self.name, self.children = name, []
    def GetName(self): return self.name
    def GetSubFolderList(self): return self.children
    def GetClipList(self): return []


class Timeline:
    def __init__(self, name): self.name = name
    def GetName(self): return self.name
    def GetTrackCount(self, kind): return 4
    def SetTrackName(self, *args): pass
    def GetStartFrame(self): return 0
    def Export(self, path, *args): Path(path).write_bytes(b'export'); return True


class Pool:
    def __init__(self, project): self.project, self.root = project, Folder('root')
    def GetRootFolder(self): return self.root
    def AddSubFolder(self, parent, name):
        child = Folder(name); parent.children.append(child); return child
    def SetCurrentFolder(self, *args): pass
    def CreateEmptyTimeline(self, name):
        tl = Timeline(name); self.project.timelines.append(tl); return tl


class Project:
    def __init__(self, mode):
        self.mode, self.timelines, self.calls = mode, [], []
        self.pool = Pool(self)
        self.output = None
        self.busy_reads = 0
    def SetSetting(self, *args): self.calls.append('setting'); return True
    def GetMediaPool(self): return self.pool
    def SetCurrentTimeline(self, *args): pass
    def GetTimelineCount(self): return len(self.timelines)
    def GetTimelineByIndex(self, i): return self.timelines[i-1]
    def SetCurrentRenderFormatAndCodec(self, *args): return self.mode != 'format-rejected'
    def SetRenderSettings(self, settings):
        self.output = Path(settings['TargetDir']) / (settings['CustomName'] + '.mp4')
        return self.mode != 'settings-rejected'
    def AddRenderJob(self): return None if self.mode == 'no-job' else 'own-job'
    def StartRendering(self, *args):
        self.calls.append('start')
        if self.mode != 'missing':
            if self.mode == 'symlink':
                self.output.symlink_to(self.output.parent / 'outside.mp4')
                (self.output.parent / 'outside.mp4').write_bytes(b'outside')
            else: self.output.write_bytes(b'' if self.mode == 'empty' else b'synthetic complete video')
        return self.mode != 'start-rejected'
    def IsRenderingInProgress(self):
        if self.mode == 'interrupted' and 'start' in self.calls: raise KeyboardInterrupt()
        self.busy_reads += 1
        return self.mode == 'busy' and self.busy_reads == 1
    def GetRenderJobStatus(self, job):
        return {} if self.mode == 'unknown' else {'JobStatus': 'Cancelled' if self.mode == 'cancelled' else 'Failed' if self.mode == 'failed' else 'Complete'}


class RenderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.studio = self.root / 'studio'; (self.studio / 'scripts').mkdir(parents=True)
        (self.studio / 'content').mkdir()
        (self.studio / 'content/demo.json').write_text('{"beats": []}')
        (self.studio / 'guides.config.json').write_text(json.dumps({'media': str(self.root/'media'), 'resolve': {'project': 'test'}}))
        self.source = self.studio / 'scripts/resolve_build.py'; self.source.write_text(SOURCE.read_text())
        self.media = self.root / 'media'; self.renders = self.media / 'demo/renders'
        self.video = self.renders/'demo-guide-v1.mp4'; self.plan = self.renders/'demo-guide-v1.plan.json'
        self.pending = self.renders/'.demo-guide-v1.pending'

    def invoke(self, mode='complete', args=()):
        project = Project(mode)
        pm = types.SimpleNamespace(LoadProject=lambda *a: project, SaveProject=lambda: True,
             ExportProject=lambda *a: True)
        resolve = types.SimpleNamespace(GetProjectManager=lambda: pm, EXPORT_DRT=1, EXPORT_FCPXML_1_10=2,
             EXPORT_OTIO=3, EXPORT_EDL=4, EXPORT_NONE=0)
        dvr = types.SimpleNamespace(scriptapp=lambda *a: resolve)
        spec = importlib.util.spec_from_file_location('fixture_resolve', self.source)
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'DaVinciResolveScript': dvr}), patch.dict(os.environ, {}, clear=False):
            # Do not inherit the operator's media override, if any.
            os.environ.pop('GUIDES_MEDIA', None)
            spec.loader.exec_module(module)
        module.plan = lambda *a: ({'title': 'Demo'}, {'beats': [], 'overlays': [], 'titles': [], 'markers': [], 'seconds': 4})
        with patch.object(sys, 'argv', ['resolve_build.py', 'demo', '1', *args]): module.main()
        return project

    def test_success_commits_complete_video_then_matching_plan(self):
        self.invoke()
        saved = json.loads(self.plan.read_text())
        self.assertEqual(saved['schema_version'], 3)
        self.assertEqual(saved['render'], {'status': 'complete', 'file': self.video.name,
           'bytes': self.video.stat().st_size, 'sha256': hashlib.sha256(self.video.read_bytes()).hexdigest()})
        self.assertFalse(self.pending.exists())

    def test_rejected_failed_cancelled_unknown_and_invalid_outputs_never_publish(self):
        for mode in ['format-rejected', 'settings-rejected', 'no-job', 'start-rejected', 'failed', 'cancelled', 'unknown', 'missing', 'empty', 'symlink', 'busy']:
            with self.subTest(mode=mode):
                # Each test attempt owns its own temporary root/version.
                with tempfile.TemporaryDirectory() as td:
                    previous = self.media; self.media = Path(td)
                    # The module reads config on import, so update fixture config.
                    config = self.studio/'guides.config.json'
                    config.write_text(json.dumps({'media':td, 'resolve':{'project':'test'}}))
                    with self.assertRaises((RuntimeError, FileNotFoundError)): self.invoke(mode)
                    self.assertFalse((Path(td)/'demo/renders/demo-guide-v1.plan.json').exists())
                    self.assertFalse((Path(td)/'demo/renders/demo-guide-v1.mp4').exists())
                    self.assertTrue((Path(td)/'demo/renders/.demo-guide-v1.pending').is_dir())
                    self.media = previous

    def test_interruption_preserves_quarantined_output_and_reservation(self):
        with self.assertRaises(KeyboardInterrupt): self.invoke('interrupted')
        self.assertFalse(self.plan.exists()); self.assertFalse(self.video.exists())
        self.assertTrue((self.pending / self.video.name).exists())
        self.assertTrue((self.pending/'job.json').exists())
        with self.assertRaises(FileExistsError): self.invoke()

    def test_existing_video_or_plan_and_dangling_symlink_are_not_replaced(self):
        self.renders.mkdir(parents=True)
        self.video.write_bytes(b'approved')
        with self.assertRaises(FileExistsError): self.invoke()
        self.assertEqual(self.video.read_bytes(), b'approved')
        self.video.unlink(); self.plan.write_text('approved-plan')
        with self.assertRaises(FileExistsError): self.invoke()
        self.assertEqual(self.plan.read_text(), 'approved-plan')
        self.plan.unlink(); self.video.symlink_to(self.renders/'absent')
        with self.assertRaises(FileExistsError): self.invoke()
        self.assertTrue(self.video.is_symlink())

    def test_no_render_saves_an_explicit_unpublishable_plan(self):
        project = self.invoke(args=('--no-render',))
        self.assertNotIn('start', project.calls)
        self.assertFalse(self.video.exists())
        self.assertEqual(json.loads(self.plan.read_text())['render'], {'status': 'not_rendered'})

    def test_atomic_reservation_and_commit_never_clobber_a_competing_file(self):
        from render_artifacts import RenderArtifacts
        a = RenderArtifacts(self.media, 'demo', 1)
        with self.assertRaises(FileExistsError): RenderArtifacts(self.media, 'demo', 1)
        self.plan.write_text('competitor')
        with self.assertRaises(FileExistsError): a.commit({'version':1})
        self.assertEqual(self.plan.read_text(), 'competitor')

    def test_concurrent_processes_cannot_claim_the_same_version(self):
        code = """import sys
from render_artifacts import RenderArtifacts
try:
 RenderArtifacts(sys.argv[1], 'demo', 1)
except FileExistsError:
 sys.exit(17)
"""
        env = {**os.environ, 'PYTHONPATH': str(SCRIPTS)}
        children = [subprocess.Popen([sys.executable, '-B', '-c', code, str(self.media)], env=env,
                      stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(2)]
        for child in children: child.communicate(timeout=10)
        self.assertEqual(sorted(child.returncode for child in children), [0, 17])
        self.assertTrue(self.pending.is_dir())
        self.assertFalse(self.plan.exists())

    def test_crash_between_video_and_plan_keeps_unpublishable_evidence(self):
        from render_artifacts import RenderArtifacts
        a = RenderArtifacts(self.media, 'demo', 1); a.render(Project('complete'))
        link = os.link
        def crash(src, dest):
            if Path(dest) == a.plan: raise OSError('synthetic plan-link failure')
            return link(src, dest)
        with patch('render_artifacts.os.link', side_effect=crash):
            with self.assertRaisesRegex(OSError, 'synthetic'): a.commit({'version':1})
        self.assertTrue(self.video.exists()); self.assertFalse(self.plan.exists())
        self.assertTrue(self.pending.exists())
        with self.assertRaises(FileExistsError): RenderArtifacts(self.media, 'demo', 1)


if __name__ == '__main__': unittest.main(verbosity=2)

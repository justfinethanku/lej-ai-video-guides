"""Rehearse archive recovery with the real builder and a synthetic Resolve SDK.

No native Resolve, media generation, credentials, or repository config is used.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('assembly_fixture', Path(__file__).with_name('timeline-assembly-fixture.py'))
assembly = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assembly)


class ExportRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.case = assembly.AssemblyTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.module = self.case.module
        self.pm = self.module.dvr.scriptapp('Resolve').GetProjectManager()
        self.calls = []

        def save():
            self.calls.append('save')
            return True

        def export(name, path, stills):
            self.calls.append('project-export')
            Path(path).write_bytes(b'synthetic project archive')
            return True

        self.pm.SaveProject, self.pm.ExportProject = save, export

    def invoke(self, version=1, export_only=False):
        args = ['resolve_build.py', 'demo', str(version)]
        if export_only:
            args.append('--export-only')
        with patch.object(sys, 'argv', args), contextlib.redirect_stdout(io.StringIO()) as output:
            self.module.main()
        return output.getvalue()

    def test_each_rejected_timeline_export_preserves_attempt_and_recovers_in_new_version(self):
        for failed_kind in [1, 2, 3, 4]:
            with self.subTest(kind=failed_kind):
                # Each archive format fails in an independent media root/project.
                case = ExportRecoveryTests()
                case.setUp()
                try:
                    original = assembly.Timeline.Export

                    def reject(timeline, path, kind, flags):
                        if kind == failed_kind:
                            return False
                        return original(timeline, path, kind, flags)

                    with patch.object(assembly.Timeline, 'Export', reject):
                        with self.assertRaisesRegex(RuntimeError, 'timeline export'):
                            case.invoke()
                        with self.assertRaisesRegex(RuntimeError, 'timeline export'):
                            case.invoke(export_only=True)
                    c = case.case
                    pending = c.renders/'.demo-guide-v1.pending'
                    before = {p.name: p.read_bytes() for p in pending.iterdir()}
                    self.assertEqual(before['demo-guide-v1.mp4'], b'synthetic complete video')
                    self.assertEqual(json.loads(before['job.json']), {'job': 'job'})
                    self.assertFalse((c.renders/'demo-guide-v1.plan.json').exists())
                    jobs = list(c.project.jobs)
                    case.invoke(export_only=True)
                    self.assertEqual(c.project.jobs, jobs)
                    self.assertEqual({p.name:p.read_bytes() for p in pending.iterdir()}, before)
                    self.assertFalse((c.renders/'demo-guide-v1.plan.json').exists())
                    with self.assertRaises(FileExistsError):
                        case.invoke()
                    case.invoke(version=2)
                    self.assertTrue((c.renders/'demo-guide-v2.plan.json').exists())
                    self.assertEqual({p.name:p.read_bytes() for p in pending.iterdir()}, before)
                finally:
                    case.doCleanups()

    def test_export_only_repairs_archives_without_changing_render_plan_log_or_project_backup(self):
        self.invoke()
        c = self.case
        paths = [c.renders/'demo-guide-v1.mp4', c.renders/'demo-guide-v1.plan.json', c.media/'demo/EDIT-LOG.md']
        paths += list((c.media/'resolve').glob('*.drp'))
        before = {p:(hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_mtime_ns) for p in paths}
        jobs, calls = list(c.project.jobs), list(self.calls)
        archive = c.media/'demo/timelines/demo-guide-v1.drt'
        archive.unlink()
        output = self.invoke(export_only=True)
        self.assertEqual(archive.read_bytes(), b'export')
        for ext in ['drt', 'fcpxml', 'otio', 'edl']:
            self.assertIn(f'demo-guide-v1.{ext}', output)
        self.assertEqual(c.project.jobs, jobs)
        self.assertEqual(self.calls, calls)
        self.assertEqual({p:(hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_mtime_ns) for p in paths}, before)

    def test_project_save_or_export_rejection_is_reported_after_render_commit(self):
        for operation in ['SaveProject', 'ExportProject']:
            with self.subTest(operation=operation):
                case = ExportRecoveryTests()
                case.setUp()
                try:
                    setattr(case.pm, operation, lambda *args: False)
                    with self.assertRaisesRegex(RuntimeError, 'project'):
                        case.invoke()
                    c = case.case
                    plan = json.loads((c.renders/'demo-guide-v1.plan.json').read_text())
                    self.assertEqual(plan['render']['status'], 'complete')
                    self.assertFalse((c.renders/'.demo-guide-v1.pending').exists())
                    self.assertFalse((c.media/'demo/EDIT-LOG.md').exists())
                    self.assertEqual(list((c.media/'resolve').glob('*.drp')), [])
                    case.invoke(export_only=True)
                    self.assertEqual(list((c.media/'resolve').glob('*.drp')), [])
                    self.assertFalse((c.media/'demo/EDIT-LOG.md').exists())
                finally:
                    case.doCleanups()

    def test_export_only_requires_current_title_and_existing_project(self):
        self.invoke()
        guide = self.case.studio/'content/demo.json'
        data = json.loads(guide.read_text())
        data['title'] = 'Renamed'
        guide.write_text(json.dumps(data))
        with self.assertRaisesRegex(SystemExit, 'No timeline "Renamed guide v1"'):
            self.invoke(export_only=True)
        self.pm.LoadProject = lambda *args: None
        with self.assertRaisesRegex(SystemExit, 'project'):
            self.invoke(export_only=True)
        self.module.dvr.scriptapp = lambda *args: None
        with self.assertRaisesRegex(SystemExit, 'not reachable'):
            self.invoke(export_only=True)


if __name__ == '__main__':
    unittest.main(verbosity=2)

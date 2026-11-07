"""Run the real planner/builder against a fault-injecting SDK, without Resolve/GPU.

The SDK records accepted media separately from attempted requests. This catches a
successful render of an incomplete timeline, which an empty-plan render test misses.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from edit_plan import plan


class Item:
    def __init__(self, path): self.path, self.properties, self.fades = path, [], []
    def GetClipProperty(self, key): return '00:00:03:00' if key == 'Duration' else self.path
    def GetFusionCompByIndex(self, index): return object()
    def GetMediaPoolItem(self): return self
    def SetProperties(self, value): self.properties.append(value); return True
    def SetFades(self, value): self.fades.append(value); return True


class Folder:
    def __init__(self, name): self.name, self.children, self.clips = name, [], []
    def GetName(self): return self.name
    def GetSubFolderList(self): return self.children
    def GetClipList(self): return self.clips


class Timeline:
    def __init__(self, project, name):
        self.project, self.name, self.tracks = project, name, {'audio': 1, 'video': 1}
    def GetName(self): return self.name
    def GetTrackCount(self, kind): return self.tracks[kind]
    def AddTrack(self, kind, *args):
        if kind == 'audio':
            self.project.audio_attempts += 1
            # A broken builder must not hang this test process. The assertion still
            # requires the first rejected AddTrack to stop, before this tripwire.
            if self.project.audio_attempts > 2: raise RuntimeError('fixture runaway audio loop')
            if self.project.reject_audio: return False
        self.tracks[kind] += 1; return True
    def SetTrackName(self, *args): pass
    def GetStartFrame(self): return 1800
    def GetEndFrame(self): return 0
    def GetStartTimecode(self): return '00:01:00:00'
    def SetCurrentTimecode(self, *args): return True
    def InsertFusionTitleIntoTimeline(self, *args): return Item('title')
    def CreateCompoundClip(self, *args): return Item('title')
    def AddMarker(self, *args): self.project.markers.append(args); return True
    def Export(self, path, *args): Path(path).write_bytes(b'export'); return True


class Pool:
    def __init__(self, project): self.project, self.root = project, Folder('root')
    def GetRootFolder(self): return self.root
    def AddSubFolder(self, parent, name):
        child = Folder(name); parent.children.append(child); return child
    def SetCurrentFolder(self, folder): self.current = folder; return True
    def ImportMedia(self, paths):
        clips = [Item(path) for path in paths]; self.current.clips.extend(clips); return clips
    def CreateEmptyTimeline(self, name):
        tl = Timeline(self.project, name); self.project.timelines.append(tl); return tl
    def AppendToTimeline(self, clips):
        clip = clips[0]
        path = clip['mediaPoolItem'].path
        kind = 'title' if path == 'title' else 'voice' if path.endswith('.wav') else 'music' if path.endswith('.mp3') else 'picture'
        self.project.attempts.append((kind, clip))
        occurrence = sum(k == kind for k,_ in self.project.attempts)
        if kind == self.project.interrupt:
            raise KeyboardInterrupt('synthetic interruption during assembly')
        if kind == self.project.reject and occurrence == self.project.reject_occurrence:
            return {'empty': [], 'none': None, 'null-item': [None], 'extra': [Item(path), Item(path)]}[self.project.reply]
        item = Item(path)
        self.project.accepted.append((kind, clip, item)); return [item]


class Project:
    def __init__(self):
        self.timelines, self.attempts, self.accepted, self.markers, self.jobs = [], [], [], [], []
        self.reject, self.interrupt, self.reply, self.reject_occurrence = None, None, 'empty', 1
        self.reject_audio, self.audio_attempts = False, 0
        self.pool = Pool(self)
    def GetTimelineCount(self): return len(self.timelines)
    def GetTimelineByIndex(self, i): return self.timelines[i-1]
    def SetSetting(self, *args): return True
    def GetMediaPool(self): return self.pool
    def SetCurrentTimeline(self, *args): return True
    def IsRenderingInProgress(self): return False
    def SetCurrentRenderFormatAndCodec(self, *args): return True
    def SetRenderSettings(self, settings):
        self.output = Path(settings['TargetDir']) / (settings['CustomName'] + '.mp4'); return True
    def AddRenderJob(self):
        self.accepted_at_render = list(self.accepted)
        self.jobs.append('job'); return 'job'
    def StartRendering(self, *args): self.output.write_bytes(b'synthetic complete video'); return True
    def GetRenderJobStatus(self, job): return {'JobStatus': 'Complete'}


class AssemblyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.studio = self.root/'studio'; self.media = self.root/'media'
        (self.studio/'scripts').mkdir(parents=True); (self.studio/'content').mkdir()
        guide = {'title':'Demo', 'chapters':['First'], 'beats':[
            {'id':'one', 'graphic':{'kind':'Flow'}, 'chapter':'First'},
            {'id':'two', 'graphic':{'kind':'Flow'}, 'lower':{'title':'Press Send', 'at':'Send#2'}}]}
        (self.studio/'content/demo.json').write_text(json.dumps(guide))
        (self.studio/'guides.config.json').write_text(json.dumps({'media':str(self.media), 'resolve':{'project':'demo'}, 'music':{'file':'bed.mp3'}}))
        for directory in ['vo','graphics']: (self.media/'demo'/directory).mkdir(parents=True)
        words = [{'text':'Send','start':.2,'end':.4},{'text':'Send','start':1.2,'end':1.5}]
        for beat in guide['beats']:
            (self.media/f"demo/vo/{beat['id']}.json").write_text(json.dumps({'seconds':2, 'words':words}))
        (self.media/'demo/graphics/manifest.json').write_text(json.dumps({
            'one':{'seconds':3, 'graphic':'one.mov', 'overlays':[]},
            'two':{'seconds':3, 'graphic':'two.mov', 'overlays':[]}}))
        self.offline = plan('demo',str(self.studio),str(self.media))[1]
        self.project = Project()
        pm = types.SimpleNamespace(LoadProject=lambda *a:self.project, SaveProject=lambda:True, ExportProject=lambda *a:True)
        resolve = types.SimpleNamespace(GetProjectManager=lambda:pm, EXPORT_DRT=1, EXPORT_FCPXML_1_10=2, EXPORT_OTIO=3, EXPORT_EDL=4, EXPORT_NONE=0)
        source = Path(os.environ.get('GUIDES_RESOLVE_SOURCE', SCRIPTS/'resolve_build.py'))
        local = self.studio/'scripts/resolve_build.py'; local.write_text(source.read_text())
        spec = importlib.util.spec_from_file_location('assembly_resolve',local); self.module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'DaVinciResolveScript':types.SimpleNamespace(scriptapp=lambda *a:resolve)}), patch.dict(os.environ):
            os.environ.pop('GUIDES_MEDIA',None); spec.loader.exec_module(self.module)
        # Styling is unrelated to placement acceptance. Import and planning run as written.
        self.module.lower_third = lambda *a: None
        self.renders = self.media/'demo/renders'

    def invoke(self, version=1):
        with patch.object(sys,'argv',['resolve_build.py','demo',str(version)]): self.module.main()

    def assert_unpublished(self, version=1):
        base = f'demo-guide-v{version}'
        self.assertFalse((self.renders/f'{base}.mp4').exists())
        self.assertFalse((self.renders/f'{base}.plan.json').exists())
        self.assertTrue((self.renders/f'.{base}.pending').is_dir())
        self.assertFalse((self.renders/f'.{base}.pending/job.json').exists())
        self.assertEqual(self.project.jobs, [])
        self.assertFalse((self.media/'demo/EDIT-LOG.md').exists())

    def test_success_places_all_media_at_expected_frames_and_only_then_renders(self):
        self.invoke()
        accepted = self.project.accepted
        self.assertEqual([kind for kind,_,_ in accepted], ['picture','voice','picture','voice','title','title','music','music','music'])
        self.assertEqual([clip['recordFrame'] for _,clip,_ in accepted], [1800,1815,1890,1905,1809,1935,1800,1890,1980])
        self.assertEqual([clip['endFrame'] for _,clip,_ in accepted], [90,60,90,60,78,39,90,90,30])
        self.assertEqual([clip['trackIndex'] for _,clip,_ in accepted], [1,1,1,1,4,4,2,2,2])
        self.assertEqual(self.project.markers[0][:3], (0,'Blue','First'))
        self.assertTrue(all(item.properties for kind,_,item in accepted if kind in ['voice','music']))
        self.assertEqual(accepted[-1][2].fades, [{'FadeIn':0, 'FadeOut':90}])
        saved = json.loads((self.renders/'demo-guide-v1.plan.json').read_text())
        self.assertEqual(saved['seconds'],6)
        self.assertEqual([b['start'] for b in saved['beats']],[0,3])
        self.assertEqual(saved['render']['status'],'complete')
        self.assertEqual(saved['render']['sha256'],hashlib.sha256(b'synthetic complete video').hexdigest())
        self.assertEqual(self.project.jobs,['job'])
        self.assertEqual(self.project.accepted_at_render,accepted)

    def test_empty_picture_voice_title_or_music_reply_never_reaches_render(self):
        for kind in ['picture','voice','title','music']:
            with self.subTest(kind=kind):
                # Reinitialize each independent version/root so previous evidence cannot mask a failure.
                case = AssemblyTests(); case.setUp()
                try:
                    case.project.reject = kind
                    with case.assertRaisesRegex(RuntimeError, f'did not place {kind}'): case.invoke()
                    case.assert_unpublished()
                    self.assertEqual(case.project.attempts[-1][0],kind)
                finally: case.doCleanups()

    def test_null_or_ambiguous_placement_reply_is_not_success(self):
        for reply in ['none','null-item','extra']:
            with self.subTest(reply=reply):
                case = AssemblyTests(); case.setUp()
                try:
                    case.project.reject, case.project.reply = 'voice', reply
                    with case.assertRaisesRegex(RuntimeError,'did not place voice'): case.invoke()
                    case.assert_unpublished()
                finally: case.doCleanups()

    def test_rejected_audio_track_stops_on_first_attempt(self):
        self.project.reject_audio = True
        with self.assertRaisesRegex(RuntimeError,'required audio track'): self.invoke()
        self.assertEqual(self.project.audio_attempts,1)
        self.assertEqual(self.project.attempts,[])
        self.assert_unpublished()

    def test_later_beat_rejection_preserves_earlier_placements_without_publishing(self):
        self.project.reject, self.project.reject_occurrence = 'voice', 2
        with self.assertRaisesRegex(RuntimeError,'did not place voice for beat two'): self.invoke()
        self.assertEqual([k for k,_,_ in self.project.accepted],['picture','voice','picture'])
        self.assert_unpublished()

    def test_partial_assembly_interrupt_then_same_version_retry_then_new_version(self):
        self.project.interrupt = 'voice'
        with self.assertRaises(KeyboardInterrupt): self.invoke()
        self.assertEqual([k for k,_,_ in self.project.accepted],['picture'])
        self.assert_unpublished()
        prior_timelines = list(self.project.timelines)
        prior_attempts = list(self.project.attempts)
        pending = self.renders/'.demo-guide-v1.pending'
        (pending/'inspection.txt').write_text('preserve partial assembly evidence')
        self.project.interrupt = None
        with self.assertRaises(FileExistsError): self.invoke()
        self.assertEqual(self.project.timelines,prior_timelines)
        self.assertEqual(self.project.attempts,prior_attempts)
        self.invoke(version=2)
        self.assertEqual(self.project.timelines[:len(prior_timelines)],prior_timelines)
        self.assertEqual((pending/'inspection.txt').read_text(),'preserve partial assembly evidence')
        self.assertFalse((self.renders/'demo-guide-v1.plan.json').exists())
        self.assertEqual(json.loads((self.renders/'demo-guide-v2.plan.json').read_text())['version'],2)
        self.assertFalse((self.renders/'.demo-guide-v2.pending').exists())


if __name__ == '__main__': unittest.main(verbosity=2)

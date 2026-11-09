"""Zooms: the plan, the Fusion build, and the check that reads them back out of a rendered video.

No Resolve or GPU. The SDK is a recording fake; the "renders" are small real videos made with ffmpeg, because the
fault this guards against (LEJ-611) is a render job that reports Complete while the picture has no camera move.
"""
import importlib.util
import json
import locale
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import zoom_check
from edit_plan import EASE, FPS, plan, plan_zooms, zoom_keys

WORDS = [{'text': 'one', 'start': 1.0, 'end': 1.2}, {'text': 'two', 'start': 2.5, 'end': 2.7}, {'text': 'three', 'start': 6.0, 'end': 6.2}]
MARKS = {'button': {'x': 1200, 'y': 200, 'w': 240, 'h': 80}}
PIVOT = (0.6875, 1 - 240 / 1080)  # the centre of MARKS['button'], as frame fractions with y counting up


def ffmpeg(*args):
    subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', *args], check=True)


def take(path, source='testsrc2=size=640x360:rate=30', seconds=4.2):
    ffmpeg('-f', 'lavfi', '-i', source, '-t', str(seconds), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '12', str(path))


def render(source, path, scale, pivot, first=36, last=81):
    """The take with frames first..last-1 zoomed by `scale` about `pivot`: what a correct (or wrong) render delivers."""
    x, y = pivot
    crop = f'crop=iw/{scale}:ih/{scale}:{x}*(iw-iw/{scale}):{1 - y}*(ih-ih/{scale}),scale=640:360,setsar=1'
    parts, chain = [], []
    if first > 0:
        chain.append(f'[0:v]trim=end_frame={first},setpts=PTS-STARTPTS,setsar=1[a]'); parts.append('[a]')
    chain.append(f'[0:v]trim=start_frame={first}:end_frame={last},setpts=PTS-STARTPTS,{crop}[b]'); parts.append('[b]')
    chain.append(f'[0:v]trim=start_frame={last},setpts=PTS-STARTPTS,setsar=1[c]'); parts.append('[c]')
    chain.append(''.join(parts) + f'concat=n={len(parts)}:v=1[v]')
    ffmpeg('-i', str(source), '-filter_complex', ';'.join(chain), '-map', '[v]', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '14', str(path))


class PlanTests(unittest.TestCase):
    def zooms(self, zoom, beat=None, cap={'marks': MARKS}):
        return plan_zooms({'id': 's1', **(beat or {}), 'zoom': zoom}, cap, WORDS, 9.0)

    def test_plans_pivot_scale_and_times(self):
        z = self.zooms([{'mark': 'button', 'at': 'one', 'until': 'two', 'scale': 1.6}])[0]
        self.assertEqual((z['mark'], z['scale'], z['start'], z['end']), ('button', 1.6, 1.5, 3.0))
        self.assertAlmostEqual(z['x'], PIVOT[0]); self.assertAlmostEqual(z['y'], PIVOT[1])
        self.assertEqual(self.zooms([{'mark': 'button', 'at': 'one'}])[0]['end'], 8.7)  # no "until": to just before the beat ends
        self.assertEqual(self.zooms([{'mark': 'button', 'at': 'one'}])[0]['scale'], 1.5)

    def test_rejects_moves_that_would_render_as_something_else(self):
        ok = {'mark': 'button', 'at': 'one', 'until': 'two'}
        for label, zoom, cap, beat in (
            ('no filmed take', [ok], None, {'media': {'file': 'x.mp4'}}),
            ('unrecorded mark', [{**ok, 'mark': 'missing'}], {'marks': MARKS}, None),
            ('take with no marks', [ok], {}, None),
            ('scale 1', [{**ok, 'scale': 1}], {'marks': MARKS}, None),
            ('scale below 1', [{**ok, 'scale': 0.8}], {'marks': MARKS}, None),
            ('scale not a number', [{**ok, 'scale': '1.5'}], {'marks': MARKS}, None),
            ('scale not finite', [{**ok, 'scale': float('inf')}], {'marks': MARKS}, None),
            ('until before at', [{'mark': 'button', 'at': 'two', 'until': 'one'}], {'marks': MARKS}, None),
            ('until equals at', [{'mark': 'button', 'at': 'one', 'until': 'one'}], {'marks': MARKS}, None),
            ('second zoom starts on the first one\'s end', [ok, {'mark': 'button', 'at': 'two', 'until': 'three'}], {'marks': MARKS}, None),
        ):
            with self.subTest(label), self.assertRaises(ValueError) as raised:
                self.zooms(zoom, beat, cap)
            self.assertIn('Beat s1', str(raised.exception))
        # Far enough apart: the second ramp starts after the first has pulled back.
        self.assertEqual(len(self.zooms([ok, {'mark': 'button', 'at': 'three'}])), 2)

    def test_a_zoom_never_borrows_the_previous_beats_marks(self):
        with tempfile.TemporaryDirectory() as temp:
            studio, media = Path(temp) / 'studio', Path(temp) / 'media'
            guide = {'title': 'Demo', 'chapters': [], 'beats': [
                {'id': 's1', 'shot': {'url': '/'}},
                {'id': 'm1', 'media': {'file': 'existing.mp4'}, 'zoom': [{'mark': 'button', 'at': 'one'}]}]}
            for path, value in ((studio / 'content/demo.json', guide), (media / 'demo/vo/s1.json', {'seconds': 8, 'words': WORDS}),
                                (media / 'demo/vo/m1.json', {'seconds': 8, 'words': WORDS}), (media / 'demo/capture/s1.json', {'seconds': 9, 'marks': MARKS}),
                                (media / 'demo/graphics/manifest.json', {'s1': {'seconds': 9, 'overlays': []}, 'm1': {'seconds': 9, 'media': {'file': 'existing.mp4'}, 'overlays': []}})):
                path.parent.mkdir(parents=True, exist_ok=True); path.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError, 'Beat m1.*filmed take'):
                plan('demo', os.fspath(studio), os.fspath(media))

    def test_keys(self):
        ease = int(EASE * FPS)
        size, pivot = zoom_keys([{'x': .3, 'y': .7, 'scale': 1.5, 'start': 1.5, 'end': 3.0}, {'x': .6, 'y': .2, 'scale': 2, 'start': 5.0, 'end': 5.2}])
        self.assertEqual(size, [(0, 1.0), (45 - ease, 1.0), (45, 1.5), (90 - ease, 1.5), (90, 1.0), (150 - ease, 1.0), (150, 2), (150, 2), (156, 1.0)])
        self.assertEqual(pivot, [(45 - ease, (.3, .7)), (90, (.3, .7)), (150 - ease, (.6, .2)), (156, (.6, .2))])
        # A zoom that begins inside the first 0.6 s starts its ramp at the clip's first frame, never before it.
        self.assertEqual(zoom_keys([{'x': .5, 'y': .5, 'scale': 1.5, 'start': 0.2, 'end': 2.0}])[0][:3], [(0, 1.0), (0, 1.0), (6, 1.5)])

    def test_check_frames_follow_the_beat_start_and_source_in_point(self):
        beat = {'id': 'b', 'picture': 'b.mp4', 'start': 2.0, 'from': 1.0, 'length': 4.0, 'zooms': [{'mark': 'm', 'x': .5, 'y': .5, 'scale': 1.5, 'start': 1.5, 'end': 3.0}]}
        got = [(c['phase'], c['frame'], c['source_frame'], c['zoomed']) for c in zoom_check.checks({'beats': [beat]})]
        self.assertEqual(got, [('start', 60 + 24, 30 + 24, False), ('hold', 60 + 58, 30 + 58, True), ('end', 60 + 93, 30 + 93, False)])
        # A zoom that starts with the clip and runs to its end has no frames before or after it: only the hold is checked.
        beat['zooms'] = [{'mark': 'm', 'x': .5, 'y': .5, 'scale': 1.5, 'start': 0.3, 'end': 3.95}]
        self.assertEqual([c['phase'] for c in zoom_check.checks({'beats': [beat]})], ['hold'])


class Recorder:
    """A Fusion tool or comp that records what the builder did to it."""
    def __init__(self, calls, name): self.__dict__['calls'], self.__dict__['name'] = calls, name
    def __setattr__(self, key, value): self.calls.append((self.name, 'set', key, getattr(value, 'name', value)))
    def AddModifier(self, *args): self.calls.append((self.name, 'AddModifier', *args))
    def SetInput(self, *args): self.calls.append((self.name, 'SetInput', *args))


class Comp:
    def __init__(self, render_start=0): self.calls, self.render_start = [], render_start
    def Lock(self): self.calls.append(('comp', 'Lock'))
    def Unlock(self): self.calls.append(('comp', 'Unlock'))
    def GetAttrs(self): return {'COMPN_RenderStart': float(self.render_start), 'COMPN_GlobalStart': -30.0}
    def FindToolByID(self, kind): return Recorder(self.calls, kind)
    def AddTool(self, kind, *args): return Recorder(self.calls, kind)


class Item:
    def __init__(self, path, comp=None): self.path, self.comp = path, comp
    def GetClipProperty(self, key): return self.path
    def AddFusionComp(self): return self.comp
    def SetProperties(self, value): return True


class Folder:
    def __init__(self, name): self.name, self.children, self.clips = name, [], []
    def GetName(self): return self.name
    def GetSubFolderList(self): return self.children
    def GetClipList(self): return self.clips


class Timeline:
    def __init__(self, name): self.name, self.tracks = name, {'audio': 1, 'video': 1}
    def GetName(self): return self.name
    def GetTrackCount(self, kind): return self.tracks[kind]
    def AddTrack(self, kind, *args): self.tracks[kind] += 1; return True
    def SetTrackName(self, *args): pass
    def GetStartFrame(self): return 0
    def AddMarker(self, *args): return True
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
        tl = Timeline(name); self.project.timelines.append(tl); return tl
    def AppendToTimeline(self, clips): return [Item(clips[0]['mediaPoolItem'].path, self.project.comp)]


class Project:
    def __init__(self): self.timelines, self.comp, self.delivers, self.pool = [], Comp(), None, Pool(self)
    def GetTimelineCount(self): return len(self.timelines)
    def GetTimelineByIndex(self, i): return self.timelines[i - 1]
    def SetSetting(self, *args): return True
    def GetMediaPool(self): return self.pool
    def SetCurrentTimeline(self, *args): return True
    def IsRenderingInProgress(self): return False
    def SetCurrentRenderFormatAndCodec(self, *args): return True
    def SetRenderSettings(self, settings):
        self.output = Path(settings['TargetDir']) / (settings['CustomName'] + '.mp4'); return True
    def AddRenderJob(self): return 'job'
    def StartRendering(self, *args): shutil.copyfile(self.delivers, self.output); return True
    def GetRenderJobStatus(self, job): return {'JobStatus': 'Complete'}


class BuildTests(unittest.TestCase):
    """The real resolve_build.py against the fake SDK, delivering real videos."""
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(); cls.addClassCleanup(cls.temp.cleanup)
        cls.videos = Path(cls.temp.name)
        take(cls.videos / 'take.mp4')
        render(cls.videos / 'take.mp4', cls.videos / 'good.mp4', 1.6, PIVOT)
        render(cls.videos / 'take.mp4', cls.videos / 'weak.mp4', 1.2, PIVOT)
        render(cls.videos / 'take.mp4', cls.videos / 'centre.mp4', 1.6, (0.5, 0.5))
        render(cls.videos / 'take.mp4', cls.videos / 'stuck.mp4', 1.6, PIVOT, first=0, last=120)
        take(cls.videos / 'blank.mp4', 'color=c=0x808080:size=640x360:rate=30')

    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        root = Path(temp.name); self.studio, self.media = root / 'studio', root / 'media'
        (self.studio / 'scripts').mkdir(parents=True); (self.studio / 'content').mkdir()
        guide = {'title': 'Demo', 'chapters': [], 'beats': [{'id': 's1', 'shot': {'url': '/'}, 'zoom': [{'mark': 'button', 'at': 'one', 'until': 'two', 'scale': 1.6}]}]}
        (self.studio / 'content/demo.json').write_text(json.dumps(guide))
        (self.studio / 'guides.config.json').write_text(json.dumps({'media': str(self.media), 'resolve': {'project': 'demo'}}))
        for directory in ('vo', 'graphics', 'capture'): (self.media / 'demo' / directory).mkdir(parents=True)
        (self.media / 'demo/vo/s1.json').write_text(json.dumps({'seconds': 3, 'words': WORDS}))
        (self.media / 'demo/capture/s1.json').write_text(json.dumps({'seconds': 4.0, 'marks': MARKS}))
        (self.media / 'demo/graphics/manifest.json').write_text(json.dumps({'s1': {'seconds': 4.0, 'overlays': []}}))
        self.take = self.media / 'demo/capture/s1.mp4'
        shutil.copyfile(self.videos / 'take.mp4', self.take)
        self.project = Project()
        pm = types.SimpleNamespace(LoadProject=lambda *a: self.project, SaveProject=lambda: True, ExportProject=lambda *a: True)
        resolve = types.SimpleNamespace(GetProjectManager=lambda: pm, EXPORT_DRT=1, EXPORT_FCPXML_1_10=2, EXPORT_OTIO=3, EXPORT_EDL=4, EXPORT_NONE=0)
        source = Path(os.environ.get('GUIDES_RESOLVE_SOURCE', SCRIPTS / 'resolve_build.py'))
        local = self.studio / 'scripts/resolve_build.py'; local.write_text(source.read_text(encoding='utf-8'), encoding='utf-8')
        spec = importlib.util.spec_from_file_location('zoom_resolve', local); self.module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'DaVinciResolveScript': types.SimpleNamespace(scriptapp=lambda *a: resolve)}), patch.dict(os.environ):
            os.environ.pop('GUIDES_MEDIA', None); spec.loader.exec_module(self.module)
        self.renders = self.media / 'demo/renders'

    def build(self, delivers, *flags, version=1):
        self.project.delivers = self.videos / delivers
        with patch.object(sys, 'argv', ['resolve_build.py', 'demo', str(version), *flags]): self.module.main()

    def assert_unpublished(self, version=1):
        self.assertFalse((self.renders / f'demo-guide-v{version}.plan.json').exists())
        self.assertFalse((self.renders / f'demo-guide-v{version}.mp4').exists())
        self.assertTrue((self.renders / f'.demo-guide-v{version}.pending/demo-guide-v{version}.mp4').is_file())  # kept for inspection

    def test_builds_the_zoom_unlocked_with_keys_from_the_clips_first_frame(self):
        self.project.comp = Comp(render_start=7)
        self.build('good.mp4')
        calls = self.project.comp.calls
        self.assertFalse([c for c in calls if c[1] in ('Lock', 'Unlock')], 'a comp built while locked renders as the bare take')
        self.assertIn(('Transform', 'set', 'Input', 'MediaIn'), calls)
        self.assertIn(('MediaOut', 'set', 'Input', 'Transform'), calls)
        self.assertEqual([c[2:] for c in calls if c[1] == 'AddModifier'], [('Size', 'BezierSpline'), ('Pivot', 'XYPath')])
        ease = int(EASE * FPS)
        self.assertEqual([c[3:] for c in calls if c[1:3] == ('SetInput', 'Size')], [(1.0, 7), (1.0, 7 + 45 - ease), (1.6, 7 + 45), (1.6, 7 + 90 - ease), (1.0, 7 + 90)])
        self.assertEqual([c[3:] for c in calls if c[1:3] == ('SetInput', 'Pivot')], [(list(PIVOT), 7 + 45 - ease), (list(PIVOT), 7 + 90)])

    def test_publishes_a_render_that_shows_the_zoom(self):
        self.build('good.mp4')
        self.assertTrue((self.renders / 'demo-guide-v1.plan.json').is_file())
        self.assertTrue((self.renders / 'demo-guide-v1.mp4').is_file())
        self.assertIn('- Zooms: 1 zoom checked in the render (3 frames)', (self.media / 'demo/EDIT-LOG.md').read_text(encoding='utf-8'))

    def test_a_complete_render_without_the_zoom_is_not_published(self):
        for label, delivers, shows in (('missing', 'take.mp4', 'hold (frame 58): wanted 1.60x, the render shows 1.00x'),
                                       ('too small', 'weak.mp4', 'hold (frame 58): wanted 1.60x'),
                                       ('about the wrong point', 'centre.mp4', 'the render shows 1.60x about the frame centre'),
                                       ('never pulls back', 'stuck.mp4', 'end (frame 93): wanted 1.00x, the render shows 1.60x')):
            with self.subTest(label):
                self.setUp()
                with self.assertRaises(RuntimeError) as raised: self.build(delivers)
                self.assertIn('beat s1, zoom on "button"', str(raised.exception))
                self.assertIn(shows, str(raised.exception))
                self.assertIn('was not published', str(raised.exception))
                self.assert_unpublished()
                self.assertFalse((self.media / 'demo/EDIT-LOG.md').exists())

    def test_the_check_can_be_skipped_on_purpose_and_says_so(self):
        self.build('take.mp4', '--no-zoom-check')
        self.assertTrue((self.renders / 'demo-guide-v1.plan.json').is_file())
        self.assertIn('- Zooms: not checked (--no-zoom-check)', (self.media / 'demo/EDIT-LOG.md').read_text(encoding='utf-8'))

    def test_no_render_skips_the_check(self):
        self.build('take.mp4', '--no-render')
        self.assertNotIn('Zooms', (self.media / 'demo/EDIT-LOG.md').read_text(encoding='utf-8'))

    def test_a_picture_with_no_detail_is_reported_not_failed(self):
        shutil.copyfile(self.videos / 'blank.mp4', self.take)
        self.build('blank.mp4')
        self.assertIn('3 frames had too little detail to tell', (self.media / 'demo/EDIT-LOG.md').read_text(encoding='utf-8'))

    def test_a_failed_fusion_build_stops_before_render(self):
        self.project.comp = None
        with self.assertRaisesRegex(RuntimeError, 'did not add a Fusion composition'): self.build('good.mp4')
        self.assertFalse((self.renders / 'demo-guide-v1.plan.json').exists())

    def test_the_log_is_written_as_utf8_whatever_the_locale(self):
        # zoom.test.mjs runs this file under the C locale, where a bare open() writes ASCII and the log's "·" fails.
        if os.environ.get('GUIDES_TEST_ASCII_LOCALE'):
            self.assertIn(locale.getencoding().lower().replace('_', '-'), ('ascii', 'us-ascii', 'ansi-x3.4-1968'))
        self.build('good.mp4')
        self.assertIn('·', (self.media / 'demo/EDIT-LOG.md').read_text(encoding='utf-8'))

    def test_command_line_check_of_an_existing_render(self):
        self.build('good.mp4')
        local = self.studio / 'scripts/zoom_check.py'; local.write_text((SCRIPTS / 'zoom_check.py').read_text(encoding='utf-8'), encoding='utf-8')
        env = {**os.environ, 'PYTHONPATH': str(SCRIPTS)}; env.pop('GUIDES_MEDIA', None)
        good = subprocess.run([sys.executable, str(local), 'demo', '1'], env=env, capture_output=True, text=True)
        self.assertEqual(good.returncode, 0, good.stdout + good.stderr)
        self.assertIn('1 zoom checked in the render (3 frames)', good.stdout)
        bad = subprocess.run([sys.executable, str(local), 'demo', '1', str(self.videos / 'take.mp4')], env=env, capture_output=True, text=True)
        self.assertEqual(bad.returncode, 1, bad.stdout + bad.stderr)
        self.assertIn('FAIL  beat s1  "button"  hold', bad.stdout)


if __name__ == '__main__': unittest.main(verbosity=2)

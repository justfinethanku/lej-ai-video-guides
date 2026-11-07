"""Offline allocation and actual Resolve main, with a recording synthetic SDK."""
import importlib.util
import json
import os
from pathlib import Path
import random
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from edit_plan import FPS, layout_overlays, plan


def overlay(start, length, label='callout'):
    return {'file': label + '.mov', 'start': start, 'length': length, 'label': label}


class LayoutTests(unittest.TestCase):
    def test_two_track_cuts_preserve_existing_placement_and_metadata(self):
        before = [overlay(0, 2, 'one'), overlay(.5, 1, 'two'), overlay(2, 1, 'three')]
        saved = json.loads(json.dumps(before))
        after, title = layout_overlays(before)
        self.assertEqual([o['track'] for o in after], [2, 3, 2])
        self.assertEqual(title, 4)
        self.assertEqual([{k:v for k,v in o.items() if k != 'track'} for o in after], saved)
        self.assertEqual(before, saved)
        self.assertEqual(layout_overlays([]), ([], 4))
        tied, _ = layout_overlays([overlay(0, 3, 'long'), overlay(0, 1, 'short')])
        self.assertEqual([o['track'] for o in tied], [2, 3])

    def test_three_simultaneous_callouts_get_distinct_tracks_below_titles(self):
        after, title = layout_overlays([overlay(0, 3), overlay(.1, 3), overlay(.2, 3)])
        self.assertEqual([o['track'] for o in after], [2, 3, 4])
        self.assertEqual(title, 5)

    def test_unsorted_manifest_keeps_source_order_but_reuses_free_tracks(self):
        before = [overlay(3, 1, 'late'), overlay(0, 2, 'first'), overlay(1, 1, 'second')]
        after, title = layout_overlays(before)
        self.assertEqual([o['label'] for o in after], ['late', 'first', 'second'])
        self.assertEqual([o['track'] for o in after], [2, 2, 3])
        self.assertEqual(title, 4)

    def test_allocation_uses_placed_frames_including_rounding_and_touching_edges(self):
        # Disjoint in seconds; rounding the start and duration separately makes them share frame 1.
        after, _ = layout_overlays([overlay(.02, .02), overlay(.04, .04)])
        self.assertEqual([o['track'] for o in after], [2, 3])
        # Overlap in seconds; the placed frame ranges only touch and can reuse V2.
        after, _ = layout_overlays([overlay(0, .04), overlay(.0334, .04)])
        self.assertEqual([o['track'] for o in after], [2, 2])

    def test_invalid_or_subframe_intervals_fail_offline(self):
        for start, length in [(-.001,1), (0,0), (0,.001), (0,-1), (float('nan'),1),
                              (0,float('inf')), ('0',1), (True,1)]:
            with self.subTest(start=start, length=length), self.assertRaises(ValueError):
                layout_overlays([overlay(start, length)])

    def test_many_unordered_intervals_are_collision_free_and_use_peak_tracks(self):
        rng = random.Random(533)
        spans = [overlay(rng.randrange(0,100)/30, rng.randrange(1,50)/30, str(i)) for i in range(100)]
        after, title = layout_overlays(spans)
        ranges = [(round(o['start']*FPS), round(o['start']*FPS)+round(o['length']*FPS), o['track']) for o in after]
        for i, (a,b,t) in enumerate(ranges):
            for c,d,u in ranges[i+1:]:
                if t == u: self.assertTrue(b <= c or d <= a)
        peak = max(sum(a <= frame < b for a,b,_ in ranges) for frame in range(150))
        self.assertEqual(len({t for _,_,t in ranges}), peak)
        self.assertEqual(title, peak + 2)


class Item:
    def GetFusionCompByIndex(self, *args): return object()
    def GetMediaPoolItem(self): return self
    def SetProperties(self, *args): pass


class Timeline:
    def __init__(self, name, fail_add=False):
        self.name, self.tracks, self.names, self.fail_add = name, 1, {}, fail_add
    def GetName(self): return self.name
    def GetTrackCount(self, kind): return self.tracks if kind == 'video' else 2
    def AddTrack(self, kind):
        if self.fail_add: return False
        self.tracks += 1; return True
    def SetTrackName(self, kind, index, label): self.names[(kind,index)] = label
    def GetStartFrame(self): return 1800
    def GetEndFrame(self): return 0
    def GetStartTimecode(self): return '00:01:00:00'
    def SetCurrentTimecode(self, *args): pass
    def InsertFusionTitleIntoTimeline(self, *args): return Item()
    def CreateCompoundClip(self, *args): return Item()
    def AddMarker(self, *args): pass
    def Export(self, *args): return True


class Folder:
    def __init__(self, name): self.name, self.children = name, []
    def GetName(self): return self.name
    def GetSubFolderList(self): return self.children


class Pool:
    def __init__(self, project): self.project, self.root, self.placed = project, Folder('root'), []
    def GetRootFolder(self): return self.root
    def AddSubFolder(self, parent, name):
        f = Folder(name); parent.children.append(f); return f
    def SetCurrentFolder(self, *args): pass
    def CreateEmptyTimeline(self, name):
        tl = Timeline(name, self.project.fail_add); self.project.timelines.append(tl); return tl
    def AppendToTimeline(self, clips):
        self.placed.extend(clips)
        if self.project.reject_callout and clips[0]['trackIndex'] == 3: return []
        return [Item()]


class AdapterTests(unittest.TestCase):
    def invoke(self, root, fail_add=False, reject_callout=False):
        studio = root/'studio'; (studio/'scripts').mkdir(parents=True); (studio/'content').mkdir()
        media = root/'media'
        guide = {'title':'Demo','chapters':['First'],'beats':[{'id':'one','graphic':{'kind':'Flow'},'chapter':'First'}]}
        (studio/'content/demo.json').write_text(json.dumps(guide))
        (studio/'guides.config.json').write_text(json.dumps({'media':str(media),'resolve':{'project':'demo'}}))
        for directory in ['vo','graphics']: (media/'demo'/directory).mkdir(parents=True)
        (media/'demo/vo/one.json').write_text(json.dumps({'seconds':4,'words':[]}))
        entries = [dict(overlay(s,3,str(i)), end=s+3) for i,s in enumerate([0,.1,.2])]
        for o in entries: o.pop('length')
        (media/'demo/graphics/manifest.json').write_text(json.dumps({'one':{'seconds':5.3,'graphic':'one.mov','overlays':entries}}))
        self.offline = plan('demo', str(studio), str(media))[1]
        project = types.SimpleNamespace(timelines=[], fail_add=fail_add, reject_callout=reject_callout)
        pool = Pool(project)
        project.IsRenderingInProgress = lambda: False
        project.GetTimelineCount = lambda: len(project.timelines)
        project.GetTimelineByIndex = lambda i: project.timelines[i-1]
        project.SetSetting = lambda *a: True
        project.GetMediaPool = lambda: pool
        project.SetCurrentTimeline = lambda *a: True
        pm = types.SimpleNamespace(LoadProject=lambda *a:project, SaveProject=lambda:True, ExportProject=lambda *a:True)
        resolve = types.SimpleNamespace(GetProjectManager=lambda:pm, EXPORT_DRT=1, EXPORT_FCPXML_1_10=2, EXPORT_OTIO=3, EXPORT_EDL=4, EXPORT_NONE=0)
        source = Path(os.environ.get('GUIDES_RESOLVE_SOURCE', SCRIPTS/'resolve_build.py'))
        local = studio/'scripts/resolve_build.py'; local.write_text(source.read_text())
        spec = importlib.util.spec_from_file_location('overlay_resolve',local); module=importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'DaVinciResolveScript':types.SimpleNamespace(scriptapp=lambda *a:resolve)}), patch.dict(os.environ):
            os.environ.pop('GUIDES_MEDIA',None); spec.loader.exec_module(module)
        module.import_into = lambda mp, bin_, paths: {p:Item() for p in paths}
        module.lower_third = lambda *a: None
        self.project, self.pool, self.media = project, pool, media
        with patch.object(sys, 'argv', ['resolve_build.py','demo','1','--no-render']): module.main()

    def test_actual_cli_consumes_planned_tracks_and_keeps_title_above_callouts(self):
        with tempfile.TemporaryDirectory() as td:
            self.invoke(Path(td))
            tl=self.project.timelines[-1]
            self.assertEqual(tl.tracks,5)
            self.assertEqual(tl.names[('video',5)],'Titles')
            callouts=self.pool.placed[2:5]
            self.assertEqual([c['trackIndex'] for c in callouts],[2,3,4])
            self.assertEqual([c['recordFrame'] for c in callouts],[1800,1803,1806])
            self.assertEqual([c['endFrame'] for c in callouts],[90,90,90])
            self.assertEqual(self.pool.placed[-1]['trackIndex'],5)
            saved=json.loads((self.media/'demo/renders/demo-guide-v1.plan.json').read_text())
            self.assertEqual(saved['beats'][0]['publish']['overlays'],[{'start':0,'end':3},{'start':.1,'end':3.1},{'start':.2,'end':3.2}])

    def test_track_creation_or_callout_placement_rejection_stops_before_commit(self):
        for options in [{'fail_add':True},{'reject_callout':True}]:
            with self.subTest(options=options), tempfile.TemporaryDirectory() as td:
                with self.assertRaisesRegex(RuntimeError,'required callout/title|did not place callout'):
                    self.invoke(Path(td),**options)
                renders=self.media/'demo/renders'
                self.assertFalse((renders/'demo-guide-v1.plan.json').exists())
                self.assertTrue((renders/'.demo-guide-v1.pending').is_dir())


if __name__ == '__main__': unittest.main(verbosity=2)

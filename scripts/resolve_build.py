"""Builds one guide's edit in DaVinci Resolve Studio, renders it, and exports the project and the cut.

    python3 scripts/resolve_build.py <slug> <version> [--no-render]

Resolve must be running with external scripting on (Preferences > System > General > External scripting: Local).
Reads the guide script (content/<slug>.json) and the media made by voice.mjs, capture.mjs and graphics.mjs, then in the
Resolve project named in guides.config.json (resolve.project) makes the timeline "<Title> guide v<version>":

  V1  screen recordings and full-frame graphics, one clip per beat, back to back
  V2, V3  callouts (ProRes 4444 with alpha), on whichever of the two is free
  V4  lower thirds and chapter titles: real Resolve Text+ titles (Inter), each wrapped as a compound clip
  A1  voiceover, one take per beat, starting LEAD seconds into its beat
  A2  the music bed, -24 dB under the voice, faded in and out

and adds a marker at each chapter. The cut is also exported as DRT, FCPXML, OTIO and EDL to <media>/<slug>/timelines/
(--export-only re-exports an existing version without rebuilding). Earlier versions' timelines are left in the project as history. The render goes to
<media>/<slug>/renders/<slug>-guide-v<version>.mp4 and the project is exported to <media>/resolve/. Every build is logged
in <media>/<slug>/EDIT-LOG.md. See docs/GUIDES.md.
"""
import json
import os
import sys
import time
from datetime import datetime

# Where Resolve Studio keeps its scripting module on macOS, Windows and Linux.
sys.path.append("/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules")
sys.path.append(os.path.expandvars(r"%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting\Modules"))
sys.path.append("/opt/resolve/Developer/Scripting/Modules")
if sys.platform == "darwin":
    os.environ.setdefault("RESOLVE_SCRIPT_LIB", "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so")
elif sys.platform.startswith("linux"):
    os.environ.setdefault("RESOLVE_SCRIPT_LIB", "/opt/resolve/libs/Fusion/fusionscript.so")
import DaVinciResolveScript as dvr  # noqa: E402

STUDIO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(STUDIO, "guides.config.json")) as _f:
    CONFIG = json.load(_f)
MEDIA = os.path.expanduser(os.environ.get("GUIDES_MEDIA", CONFIG["media"]))
PROJECT = CONFIG["resolve"]["project"]
FPS = 30
LEAD = 0.5  # seconds of picture before each beat's narration (capture.mjs, graphics.mjs)
TAIL = 0.8
MUSIC = os.path.join(MEDIA, CONFIG["music"]["file"]) if CONFIG.get("music") else None
MUSIC_DB = float(CONFIG.get("music", {}).get("db", -24))
VOICE_DB = float(CONFIG["resolve"].get("voiceDb", -2))  # a mono take on a stereo track plays ~3 dB hot
FONT = CONFIG.get("brand", {}).get("font", "Inter")


def _rgb(hex_color, fallback):
    h = (hex_color or fallback).lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


PLATE = _rgb(CONFIG.get("brand", {}).get("text"), "#333333")  # lower-third plate: the brand's text colour
LOWER_SECONDS = 4.5


def read(path):
    with open(path) as f:
        return json.load(f)


def word_time(at, words):
    """Seconds into a take at which `at` ("word", "word#2" or a number) is said; mirrors atSeconds in capture.mjs."""
    if isinstance(at, (int, float)):
        return float(at)
    w, _, nth = str(at).partition("#")
    want = "".join(ch for ch in w.lower() if ch.isalnum() or ch == "'")
    seen = 0
    for word in words:
        if "".join(ch for ch in word["text"].lower() if ch.isalnum() or ch == "'") == want:
            seen += 1
            if seen == int(nth or 1):
                return word["start"]
    raise ValueError(f'"{at}" is not said in this beat')


def plan(slug):
    """Where every piece goes, in seconds from the start of the video."""
    guide = read(os.path.join(STUDIO, "content", f"{slug}.json"))
    manifest = read(os.path.join(MEDIA, slug, "graphics", "manifest.json"))
    chapters = guide["chapters"]
    t = 0.0
    beats, overlays, titles, markers = [], [], [], []
    chapter_no = 0
    for beat in guide["beats"]:
        vo = read(os.path.join(MEDIA, slug, "vo", f"{beat['id']}.json"))
        entry = manifest[beat["id"]]
        media_from = 0.0
        if beat.get("media"):
            picture = entry["media"]["file"]
            media_from = float(entry["media"].get("from", 0))
            length = entry["seconds"]
        elif beat.get("graphic"):
            picture = entry["graphic"]
            length = entry["seconds"]
        else:
            cap = read(os.path.join(MEDIA, slug, "capture", f"{beat['id']}.json"))
            picture = os.path.join(MEDIA, slug, "capture", f"{beat['id']}.mp4")
            # The take runs a touch past the narration's tail; never ask for more frames than the file has.
            length = int(cap["seconds"] * FPS) / FPS
        # Whole frames, so each clip butts against the next with no gap.
        length = round(length * FPS) / FPS
        zooms = []
        for z in beat.get("zoom", []):
            box = cap["marks"][z["mark"]]
            zs = LEAD + word_time(z["at"], vo["words"])
            ze = LEAD + word_time(z["until"], vo["words"]) if z.get("until") else length - 0.3
            zooms.append({"x": (box["x"] + box["w"] / 2) / 1920, "y": 1 - (box["y"] + box["h"] / 2) / 1080, "scale": z.get("scale", 1.5), "start": zs, "end": ze})
        beats.append({"id": beat["id"], "picture": picture, "from": media_from, "start": t, "length": length, "zooms": zooms, "vo": os.path.join(MEDIA, slug, "vo", f"{beat['id']}.wav"), "vo_start": t + LEAD, "vo_seconds": vo["seconds"]})
        for o in entry["overlays"]:
            overlays.append({"file": o["file"], "start": t + o["start"], "length": o["end"] - o["start"], "label": o["label"]})
        if beat.get("chapter"):
            chapter_no += 1
            titles.append({"title": beat["chapter"], "text": f"Part {chapter_no} of {len(chapters)}", "start": t + 0.3, "length": min(LOWER_SECONDS, length - 0.4)})
            markers.append({"at": t, "name": beat["chapter"], "note": f"Part {chapter_no} of {len(chapters)} · beat {beat['id']}"})
        if beat.get("lower"):
            lo = beat["lower"]
            start = t + LEAD + (word_time(lo["at"], vo["words"]) if lo.get("at") is not None else 0) - 0.2
            titles.append({"title": lo["title"], "text": lo.get("text", ""), "start": start, "length": min(LOWER_SECONDS, t + length - start - 0.2)})
        t += length
    return guide, {"beats": beats, "overlays": overlays, "titles": titles, "markers": markers, "seconds": t}


def lower_third(comp, title_text, sub_text, frames):
    """Styles a Text+ title as the guides' lower third: a dark plate, a white Inter SemiBold line and a lighter line
    under it, sliding in and fading over 10 frames at each end."""
    comp.Lock()
    comp.StartUndo("Guide lower third")
    t1 = comp.FindToolByID("TextPlus")
    out = comp.FindToolByID("MediaOut")
    W, H = 1920.0, 1080.0
    size1, size2 = 0.036, 0.026
    x0, y1, y2 = 0.075, 0.155, 0.105

    def style(t, text, weight, size, y, rgb):
        t.SetInput("StyledText", text)
        t.SetInput("Font", FONT)
        t.SetInput("Style", weight)
        t.SetInput("Size", size)
        t.SetInput("HorizontalJustificationNew", 0)
        t.SetInput("HorizontalLeftCenterRight", -1)
        t.SetInput("Center", [x0, y])
        t.SetInput("Red1", rgb[0])
        t.SetInput("Green1", rgb[1])
        t.SetInput("Blue1", rgb[2])
        t.SetInput("Enabled2", 0)

    style(t1, title_text, "SemiBold", size1, y1, (1, 1, 1))
    t2 = comp.AddTool("TextPlus", 0, 2)
    style(t2, sub_text or "", "Regular", size2, y2, (0.86, 0.86, 0.88))
    # Inter SemiBold runs about 0.62 x its size per character; the plate is the longer line plus 32 px each side.
    text_px = max(len(title_text) * size1, len(sub_text or "") * size2) * 1080 * 0.62
    wpx, hpx = text_px + 64, (150 if sub_text else 96)
    plate = comp.AddTool("Background", 0, 3)
    for k, v in (("TopLeftRed", PLATE[0]), ("TopLeftGreen", PLATE[1]), ("TopLeftBlue", PLATE[2]), ("TopLeftAlpha", 0.94), ("UseFrameFormatSettings", 0), ("Width", 1920), ("Height", 1080)):
        plate.SetInput(k, v)
    mask = comp.AddTool("RectangleMask", 0, 4)
    left = x0 * W - 32
    top = (1 - (y1 + 0.045)) * H
    mask.SetInput("Width", wpx / W)
    mask.SetInput("Height", hpx / H)
    mask.SetInput("Center", [(left + wpx / 2) / W, 1 - (top + hpx / 2) / H])
    mask.SetInput("CornerRadius", 0.08)
    plate.EffectMask = mask
    clear = comp.AddTool("Background", 0, 5)
    for k, v in (("TopLeftAlpha", 0), ("UseFrameFormatSettings", 0), ("Width", 1920), ("Height", 1080)):
        clear.SetInput(k, v)
    a = comp.AddTool("Merge", 1, 1)
    a.Background, a.Foreground = plate, t1
    b = comp.AddTool("Merge", 1, 2)
    b.Background, b.Foreground = a, t2
    move = comp.AddTool("Transform", 1, 3)
    move.Input = b
    fade = comp.AddTool("Merge", 1, 4)
    fade.Background, fade.Foreground = clear, move
    out.Input = fade
    move.AddModifier("Center", "XYPath")
    fade.AddModifier("Blend", "BezierSpline")
    for fr, cx, blend in ((0, 0.49, 0.0), (10, 0.5, 1.0), (frames - 11, 0.5, 1.0), (frames - 1, 0.5, 0.0)):
        move.SetInput("Center", [cx, 0.5], fr)
        fade.SetInput("Blend", blend, fr)
    comp.EndUndo(True)
    comp.Unlock()


def zoom(item, zooms):
    """Push in on part of a screen recording: a Fusion Transform on the clip, scaling about the point of interest
    (which keeps the frame covered), easing in and out over 0.6 s. Callouts are drawn in unzoomed positions, so a
    beat's script never zooms while a callout is up."""
    comp = item.AddFusionComp()
    comp.Lock()
    src = comp.FindToolByID("MediaIn")
    out = comp.FindToolByID("MediaOut")
    xf = comp.AddTool("Transform", 1, 1)
    xf.Input = src
    out.Input = xf
    xf.AddModifier("Size", "BezierSpline")
    xf.AddModifier("Pivot", "XYPath")
    ease = int(0.6 * FPS)
    xf.SetInput("Size", 1.0, 0)
    for z in zooms:
        a, b = int(z["start"] * FPS), int(z["end"] * FPS)
        xf.SetInput("Pivot", [z["x"], z["y"]], max(0, a - ease))
        xf.SetInput("Size", 1.0, max(0, a - ease))
        xf.SetInput("Size", z["scale"], a)
        xf.SetInput("Size", z["scale"], max(a, b - ease))
        xf.SetInput("Size", 1.0, b)
        xf.SetInput("Pivot", [z["x"], z["y"]], b)
    comp.Unlock()


def export_timeline(resolve, tl, slug, version):
    """The cut in interchange formats, next to the render: DRT (Resolve's own, complete: re-import with File > Import
    > Timeline), FCPXML 1.10 (Final Cut, Premiere via converters), OTIO (OpenTimelineIO) and EDL (V1 cuts only; an EDL
    can't carry titles, overlays or the music). Returns the files written."""
    out_dir = os.path.join(MEDIA, slug, "timelines")
    os.makedirs(out_dir, exist_ok=True)
    base = os.path.join(out_dir, f"{slug}-guide-v{version}")
    wrote = []
    for ext, kind in (("drt", resolve.EXPORT_DRT), ("fcpxml", resolve.EXPORT_FCPXML_1_10), ("otio", resolve.EXPORT_OTIO), ("edl", resolve.EXPORT_EDL)):
        if tl.Export(f"{base}.{ext}", kind, resolve.EXPORT_NONE):
            wrote.append(f"timelines/{os.path.basename(base)}.{ext}")
    return wrote


def folder(mp, parent, name):
    for f in parent.GetSubFolderList():
        if f.GetName() == name:
            return f
    return mp.AddSubFolder(parent, name)


def import_into(mp, bin_, paths):
    mp.SetCurrentFolder(bin_)
    have = {c.GetClipProperty("File Path"): c for c in bin_.GetClipList()}
    need = [p for p in paths if p not in have]
    if need:
        for item in mp.ImportMedia(need) or []:
            have[item.GetClipProperty("File Path")] = item
    missing = [p for p in paths if p not in have]
    if missing:
        raise RuntimeError(f"Resolve did not import: {missing[:3]}")
    return have


def export_only(slug, version):
    """python3 scripts/resolve_build.py <slug> <version> --export-only: re-export an existing timeline's EDL/XML/DRT."""
    resolve = dvr.scriptapp("Resolve")
    project = resolve.GetProjectManager().LoadProject(PROJECT)
    guide = read(os.path.join(STUDIO, "content", f"{slug}.json"))
    name = f"{guide['title']} guide v{version}"
    tl = next((project.GetTimelineByIndex(i) for i in range(1, project.GetTimelineCount() + 1) if project.GetTimelineByIndex(i).GetName() == name), None)
    if not tl:
        sys.exit(f'No timeline "{name}" in {PROJECT}.')
    project.SetCurrentTimeline(tl)
    print(name, export_timeline(resolve, tl, slug, version))


def main():
    slug, version = sys.argv[1], int(sys.argv[2])
    if "--export-only" in sys.argv:
        return export_only(slug, version)
    render = "--no-render" not in sys.argv
    guide, p = plan(slug)
    resolve = dvr.scriptapp("Resolve")
    if not resolve:
        sys.exit("Resolve is not reachable. Open it and turn on Preferences > System > General > External scripting: Local.")
    pm = resolve.GetProjectManager()
    project = pm.LoadProject(PROJECT) or pm.CreateProject(PROJECT)
    project.SetSetting("timelineResolutionWidth", "1920")
    project.SetSetting("timelineResolutionHeight", "1080")
    project.SetSetting("timelineFrameRate", "30")
    mp = project.GetMediaPool()
    root = mp.GetRootFolder()
    top = folder(mp, root, guide["title"])
    # One bin per version: a re-voiced or re-rendered file keeps its name, and Resolve keeps a clip's length and
    # frames from when it was first imported, so each version imports its own fresh copies.
    vbin = folder(mp, top, f"v{version}")
    bins = {k: folder(mp, vbin, k) for k in ("Screen", "Graphics", "Callouts", "Voice", "Titles")}
    music_bin = folder(mp, root, "Music")

    pics = import_into(mp, bins["Screen"], sorted({b["picture"] for b in p["beats"] if b["picture"].endswith(".mp4")}))
    pics.update(import_into(mp, bins["Graphics"], sorted({b["picture"] for b in p["beats"] if not b["picture"].endswith(".mp4")})))
    overs = import_into(mp, bins["Callouts"], [o["file"] for o in p["overlays"]]) if p["overlays"] else {}
    voices = import_into(mp, bins["Voice"], [b["vo"] for b in p["beats"]])
    music = import_into(mp, music_bin, [MUSIC])[MUSIC] if MUSIC else None

    # Titles first, in a work timeline (Resolve's title insert is an insert edit on V1), each wrapped as a compound clip.
    mp.SetCurrentFolder(bins["Titles"])
    work_name = f"{guide['title']} titles v{version}"
    work = mp.CreateEmptyTimeline(work_name)
    project.SetCurrentTimeline(work)
    title_items = []
    for i, ti in enumerate(p["titles"]):
        frames = max(30, int(round(ti["length"] * FPS)))
        work.SetCurrentTimecode(work.GetEndFrame() and _tc(work.GetEndFrame(), work) or work.GetStartTimecode())
        item = work.InsertFusionTitleIntoTimeline("Text+")
        lower_third(item.GetFusionCompByIndex(1), ti["title"], ti["text"], frames)
        compound = work.CreateCompoundClip([item], {"name": f"{slug} title {i + 1:02d} · {ti['title']}"})
        title_items.append((compound.GetMediaPoolItem(), frames, ti))

    name = f"{guide['title']} guide v{version}"
    for i in range(1, project.GetTimelineCount() + 1):
        if project.GetTimelineByIndex(i).GetName() == name:
            sys.exit(f'The timeline "{name}" already exists. Build the next version number instead; old versions stay as history.')
    mp.SetCurrentFolder(vbin)
    tl = mp.CreateEmptyTimeline(name)
    project.SetCurrentTimeline(tl)
    while tl.GetTrackCount("video") < 4:
        tl.AddTrack("video")
    while tl.GetTrackCount("audio") < 2:
        tl.AddTrack("audio", "stereo")
    for idx, label in ((1, "Screen and graphics"), (2, "Callouts"), (3, "Callouts"), (4, "Titles")):
        tl.SetTrackName("video", idx, label)
    tl.SetTrackName("audio", 1, "Voice")
    tl.SetTrackName("audio", 2, "Music")
    start = tl.GetStartFrame()
    F = lambda s: start + int(round(s * FPS))  # noqa: E731

    for b in p["beats"]:
        n = int(round(b["length"] * FPS))
        first = int(round(b["from"] * FPS))
        placed = mp.AppendToTimeline([{"mediaPoolItem": pics[b["picture"]], "startFrame": first, "endFrame": first + n, "trackIndex": 1, "recordFrame": F(b["start"]), "mediaType": 1}])
        if b["zooms"] and placed:
            zoom(placed[0], b["zooms"])
        vn = int(round(b["vo_seconds"] * FPS))
        said = mp.AppendToTimeline([{"mediaPoolItem": voices[b["vo"]], "startFrame": 0, "endFrame": vn, "trackIndex": 1, "recordFrame": F(b["vo_start"]), "mediaType": 2}])
        for it in said or []:
            it.SetProperties({"AudioVolumeEnabled": True, "AudioVolume": VOICE_DB})

    busy = {2: [], 3: []}
    for o in p["overlays"]:
        s, e = o["start"], o["start"] + o["length"]
        track = next((k for k in (2, 3) if all(e <= a or s >= z for a, z in busy[k])), 3)
        busy[track].append((s, e))
        n = int(round(o["length"] * FPS))
        mp.AppendToTimeline([{"mediaPoolItem": overs[o["file"]], "startFrame": 0, "endFrame": n, "trackIndex": track, "recordFrame": F(s), "mediaType": 1}])

    for mpi, frames, ti in title_items:
        mp.AppendToTimeline([{"mediaPoolItem": mpi, "startFrame": 0, "endFrame": frames, "trackIndex": 4, "recordFrame": F(ti["start"]), "mediaType": 1}])

    # The music bed runs under everything and a little past the last word; a second pass covers a long video.
    if music:
        total = p["seconds"] + 1.0
        bed = float(music.GetClipProperty("Duration") and _seconds(music.GetClipProperty("Duration"))) or 480.0
        at = 0.0
        while at < total:
            n = int(round(min(bed, total - at) * FPS))
            placed = mp.AppendToTimeline([{"mediaPoolItem": music, "startFrame": 0, "endFrame": n, "trackIndex": 2, "recordFrame": F(at), "mediaType": 2}])
            for it in placed or []:
                it.SetProperties({"AudioVolumeEnabled": True, "AudioVolume": MUSIC_DB})
                it.SetFades({"FadeIn": FPS if at == 0 else 0, "FadeOut": 3 * FPS if at + bed >= total else 0})
            at += bed

    for m in p["markers"]:
        tl.AddMarker(int(round(m["at"] * FPS)), "Blue", m["name"], m["note"], 1)

    log = [f"## v{version} · {datetime.now().strftime('%a %b %d %Y, %I:%M %p')}", "", f"- Timeline: **{name}** (project {PROJECT}); titles built in **{work_name}**",
           f"- Length: {int(p['seconds'] // 60)} min {int(p['seconds'] % 60)} s · {len(p['beats'])} beats · {len(p['overlays'])} callouts · {len(p['titles'])} titles",
           f"- Music: {os.path.basename(MUSIC)} at {MUSIC_DB:.0f} dB, 1 s fade in, 3 s fade out" if MUSIC else "- Music: none"]

    if render:
        out_dir = os.path.join(MEDIA, slug, "renders")
        os.makedirs(out_dir, exist_ok=True)
        project.SetCurrentRenderFormatAndCodec("mp4", "H264")
        project.SetRenderSettings({"SelectAllFrames": True, "TargetDir": out_dir, "CustomName": f"{slug}-guide-v{version}", "FormatWidth": 1920, "FormatHeight": 1080, "FrameRate": 30,
                                   "VideoQuality": 12000, "ExportVideo": True, "ExportAudio": True, "AudioCodec": "aac", "AudioBitDepth": 16, "AudioSampleRate": 48000})
        job = project.AddRenderJob()
        project.StartRendering([job], False)
        while project.IsRenderingInProgress():
            time.sleep(2)
        status = project.GetRenderJobStatus(job)
        log.append(f"- Render: renders/{slug}-guide-v{version}.mp4 · {status.get('JobStatus')} in {status.get('TimeTakenToRenderInMs', 0) / 1000:.0f} s")

    log.append("- Timeline exports: " + ", ".join(export_timeline(resolve, tl, slug, version)))
    # Where each beat sits in the video: loops.mjs cuts the written guide's motion clips from the render with it.
    os.makedirs(os.path.join(MEDIA, slug, "renders"), exist_ok=True)
    with open(os.path.join(MEDIA, slug, "renders", f"{slug}-guide-v{version}.plan.json"), "w") as f:
        json.dump({"version": version, "timeline": name, "seconds": p["seconds"], "beats": [{"id": b["id"], "start": b["start"], "length": b["length"]} for b in p["beats"]]}, f, indent=2)
    os.makedirs(os.path.join(MEDIA, "resolve"), exist_ok=True)
    pm.SaveProject()
    drp = os.path.join(MEDIA, "resolve", f"{PROJECT} {datetime.now().strftime('%Y-%m-%d %H%M')}.drp")
    pm.ExportProject(PROJECT, drp, False)
    log.append(f"- Project export: resolve/{os.path.basename(drp)}")
    with open(os.path.join(STUDIO, "content", f"{slug}.json")) as f:
        log.append(f"- Script: content/{slug}.json ({len(json.load(f)['beats'])} beats)")
    path = os.path.join(MEDIA, slug, "EDIT-LOG.md")
    head = "" if os.path.exists(path) else f"# {guide['title']} guide: edit log\n\nNewest first is not enforced; each build appends. See docs/GUIDES.md for how a build works.\n\n"
    with open(path, "a") as f:
        f.write(head + "\n".join(log) + "\n\n")
    print("\n".join(log))


def _tc(frame, tl):
    fps = FPS
    f = frame
    return f"{f // (3600 * fps):02d}:{(f // (60 * fps)) % 60:02d}:{(f // fps) % 60:02d}:{f % fps:02d}"


def _seconds(tc):
    h, m, s, f = (int(x) for x in tc.replace(";", ":").split(":"))
    return h * 3600 + m * 60 + s + f / FPS


if __name__ == "__main__":
    main()

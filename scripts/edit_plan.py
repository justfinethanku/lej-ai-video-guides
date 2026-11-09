"""File-based edit planning, independent of Resolve and machine configuration.

The caller supplies the studio and media roots. This module reads only guide inputs;
Resolve operations and writing the resulting versioned plan belong to resolve_build.py.
"""
import heapq
import json
import math
import os

FPS = 30
LEAD = 0.5
LOWER_SECONDS = 4.5
EASE = 0.6  # seconds a zoom takes to push in, and to pull back out


def layout_overlays(overlays):
    """Assign callouts to free video tracks using the frames Resolve will place.

    Keep V2/V3 for ordinary cuts and put titles above every callout track. Sort
    only for allocation; retain the manifest's order and metadata in the result.
    """
    scheduled = [dict(o) for o in overlays]
    intervals = []
    for i, o in enumerate(scheduled):
        values = (o["start"], o["length"])
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
            raise ValueError(f'Callout {o["file"]}: start and length must be finite seconds')
        start, frames = round(o["start"] * FPS), round(o["length"] * FPS)
        if o["start"] < 0 or frames < 1:
            raise ValueError(f'Callout {o["file"]}: requires a nonnegative start and at least one frame')
        intervals.append((start, start + frames, i))
    # Release by end frame, then choose the lowest free track number. A single
    # end-frame heap would change which track is reused when several are free.
    busy, free = [], []
    slots = 0
    for start, end, i in sorted(intervals, key=lambda span: (span[0], span[2])):
        while busy and busy[0][0] <= start:
            _, released = heapq.heappop(busy)
            heapq.heappush(free, released)
        if free:
            slot = heapq.heappop(free)
        else:
            slot = slots
            slots += 1
        heapq.heappush(busy, (end, slot))
        scheduled[i]["track"] = slot + 2
    return scheduled, max(4, slots + 2)


def read(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def plan_zooms(beat, cap, words, length):
    """A beat's zooms as pivot (frame fractions, y up), scale and start/end seconds into the take.

    Rejects what would render as a different move from the one written: a zoom on a beat with no filmed take, a
    mark the take did not record, a scale that uncovers the frame, an end before its start, or two zooms whose
    ramps run into each other.
    """
    if not beat.get("zoom"):
        return []
    if cap is None:
        raise ValueError(f'Beat {beat["id"]}: a zoom needs a filmed take; media and graphic beats have no recorded marks')
    zooms = []
    for z in beat["zoom"]:
        where = f'Beat {beat["id"]}: zoom on "{z.get("mark")}"'
        box = cap.get("marks", {}).get(z.get("mark"))
        if not box:
            raise ValueError(f"{where}: the take did not record that mark")
        scale = z.get("scale", 1.5)
        if isinstance(scale, bool) or not isinstance(scale, (int, float)) or not math.isfinite(scale) or scale <= 1:
            raise ValueError(f"{where}: scale must be a number above 1 (a smaller picture leaves the frame uncovered)")
        zs = LEAD + word_time(z["at"], words)
        ze = LEAD + word_time(z["until"], words) if z.get("until") else length - 0.3
        if ze <= zs:
            raise ValueError(f'{where}: "until" must come after "at"')
        if zooms and zs - EASE < zooms[-1]["end"]:
            raise ValueError(f"{where}: starts before the previous zoom has pulled back; leave {EASE:g} s between them")
        zooms.append({"mark": z["mark"], "x": (box["x"] + box["w"] / 2) / 1920, "y": 1 - (box["y"] + box["h"] / 2) / 1080, "scale": scale, "start": zs, "end": ze})
    return zooms


def zoom_keys(zooms):
    """Keyframes for a clip's zooms, counted in frames from the clip's first frame.

    Returns (size keys, pivot keys). Each zoom holds 1.0 until EASE before its start, reaches its scale at the
    start, holds it until EASE before the end, and is back at 1.0 at the end. The pivot sits on the element for
    the whole move; scaling about a point inside the frame keeps the frame covered.
    """
    ease = int(EASE * FPS)
    size, pivot = [(0, 1.0)], []
    for z in zooms:
        a, b = int(z["start"] * FPS), int(z["end"] * FPS)
        size += [(max(0, a - ease), 1.0), (a, z["scale"]), (max(a, b - ease), z["scale"]), (b, 1.0)]
        pivot += [(max(0, a - ease), (z["x"], z["y"])), (b, (z["x"], z["y"]))]
    return size, pivot


def word_time(at, words):
    """Seconds into a take at which `at` ("word", "word#2" or a number) is said; mirrors atSeconds in timing.mjs."""
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


def plan(slug, studio, media):
    """Where every piece goes, in seconds from the start of the video."""
    guide = read(os.path.join(studio, "content", f"{slug}.json"))
    manifest = read(os.path.join(media, slug, "graphics", "manifest.json"))
    chapters = guide["chapters"]
    t = 0.0
    beats, overlays, titles, markers = [], [], [], []
    chapter_no = 0
    for beat in guide["beats"]:
        vo = read(os.path.join(media, slug, "vo", f"{beat['id']}.json"))
        entry = manifest[beat["id"]]
        media_from = 0.0
        cap = None
        if beat.get("media"):
            picture = entry["media"]["file"]
            media_from = float(entry["media"].get("from", 0))
            length = entry["seconds"]
        elif beat.get("graphic"):
            picture = entry["graphic"]
            length = entry["seconds"]
        else:
            cap = read(os.path.join(media, slug, "capture", f"{beat['id']}.json"))
            picture = os.path.join(media, slug, "capture", f"{beat['id']}.mp4")
            # The take runs a touch past the narration's tail; never ask for more frames than the file has.
            length = int(cap["seconds"] * FPS) / FPS
        # Whole frames, so each clip butts against the next with no gap.
        length = round(length * FPS) / FPS
        zooms = plan_zooms(beat, cap, vo["words"], length)
        beats.append({"id": beat["id"], "picture": picture, "from": media_from, "start": t, "length": length, "zooms": zooms, "vo": os.path.join(media, slug, "vo", f"{beat['id']}.wav"), "vo_start": t + LEAD, "vo_seconds": vo["seconds"]})
        beats[-1]["publish"] = {
            "graphic": bool(entry.get("graphic")),
            "overlays": [{"start": o["start"], "end": o["end"]} for o in entry["overlays"]],
        }
        # Snapshot alignment with the cut; working voice files can change before publication.
        beats[-1]["narration"] = {k: vo.get(k) for k in ("seconds", "words")}
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
    overlays, title_track = layout_overlays(overlays)
    return guide, {"beats": beats, "overlays": overlays, "title_track": title_track, "titles": titles, "markers": markers, "seconds": t}


def publication_plan(p, version, timeline):
    """Snapshot the cut and still-selection metadata together for later publishing."""
    return {
        "schema_version": 2, "version": version, "timeline": timeline, "seconds": p["seconds"],
        "beats": [{k: b[k] for k in ("id", "start", "length", "vo_start", "narration", "publish")} for b in p["beats"]],
    }

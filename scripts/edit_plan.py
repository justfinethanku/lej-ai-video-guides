"""File-based edit planning, independent of Resolve and machine configuration.

The caller supplies the studio and media roots. This module reads only guide inputs;
Resolve operations and writing the resulting versioned plan belong to resolve_build.py.
"""
import json
import math
import os

FPS = 30
LEAD = 0.5
LOWER_SECONDS = 4.5


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
    ends = []
    for start, end, i in sorted(intervals, key=lambda span: (span[0], span[2])):
        slot = next((j for j, busy_until in enumerate(ends) if busy_until <= start), len(ends))
        if slot == len(ends):
            ends.append(end)
        else:
            ends[slot] = end
        scheduled[i]["track"] = slot + 2
    return scheduled, max(4, len(ends) + 2)


def read(path):
    with open(path) as f:
        return json.load(f)


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
        zooms = []
        for z in beat.get("zoom", []):
            box = cap["marks"][z["mark"]]
            zs = LEAD + word_time(z["at"], vo["words"])
            ze = LEAD + word_time(z["until"], vo["words"]) if z.get("until") else length - 0.3
            zooms.append({"x": (box["x"] + box["w"] / 2) / 1920, "y": 1 - (box["y"] + box["h"] / 2) / 1080, "scale": z.get("scale", 1.5), "start": zs, "end": ze})
        beats.append({"id": beat["id"], "picture": picture, "from": media_from, "start": t, "length": length, "zooms": zooms, "vo": os.path.join(media, slug, "vo", f"{beat['id']}.wav"), "vo_start": t + LEAD, "vo_seconds": vo["seconds"]})
        beats[-1]["publish"] = {
            "graphic": bool(entry.get("graphic")),
            "overlays": [{"start": o["start"], "end": o["end"]} for o in entry["overlays"]],
        }
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
        "beats": [{k: b[k] for k in ("id", "start", "length", "publish")} for b in p["beats"]],
    }

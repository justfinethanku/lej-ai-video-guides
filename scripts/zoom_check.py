"""Check a finished render for the zooms the script asked for.

    python3 scripts/zoom_check.py <slug> <version>

Resolve can report a zoom as built, read its keyframes back correctly, finish the render job as Complete, and still
deliver a picture with no camera move in it. So the check reads the rendered video itself. For each zoom it takes
three frames from the render (just before the push in, the middle of the hold, just after the pull back) and
compares each with the same moment of the source take: unzoomed, zoomed as written, and zoomed a little less or
more. The render passes when the unzoomed frames look unzoomed and the hold looks like the zoom that was written.

resolve_build.py runs this after every render and stops before publishing the cut if a zoom is missing. Needs ffmpeg.
"""
import json
import os
import subprocess
import sys

from edit_plan import EASE, FPS

W, H = 320, 180
FLAT = 0.75        # grey levels (of 255): below this spread the picture has too little detail to tell a zoom apart
NEAR = (0.85, 1.15)  # the hold must match the written scale better than a scale 15% smaller or larger


def _ffmpeg(args):
    done = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", *args, "-f", "rawvideo", "-"], capture_output=True)
    if done.returncode or not done.stdout:
        raise RuntimeError(f"ffmpeg could not read a frame: {done.stderr.decode(errors='replace').strip()[:300]}")
    return done.stdout


def _at(frame):
    # The middle of the frame, so rounding in the container's timestamps cannot land on a neighbour.
    return f"{(frame + 0.5) / FPS:.4f}"


def render_frame(video, frame):
    return _ffmpeg(["-ss", _at(frame), "-i", os.fspath(video), "-frames:v", "1", "-vf", f"scale={W}:{H}:flags=area,format=gray"])


def source_views(video, frame, views):
    """One frame of the source take, seen through each (scale, pivot x, pivot y) in `views`; pivot y counts up."""
    chains = [f"[0:v]split={len(views)}" + "".join(f"[s{i}]" for i in range(len(views)))]
    for i, (scale, x, y) in enumerate(views):
        chains.append(f"[s{i}]crop=iw/{scale}:ih/{scale}:{x}*(iw-iw/{scale}):{1 - y}*(ih-ih/{scale}),scale={W}:{H}:flags=area,setsar=1[c{i}]")
    chains.append("".join(f"[c{i}]" for i in range(len(views))) + f"vstack=inputs={len(views)},format=gray")  # views always has two or more
    raw = _ffmpeg(["-ss", _at(frame), "-i", os.fspath(video), "-frames:v", "1", "-filter_complex", ";".join(chains)])
    return [raw[i * W * H:(i + 1) * W * H] for i in range(len(views))]


def distance(a, b):
    return sum(abs(x - y) for x, y in zip(a, b)) / len(a)


def checks(p):
    """Which frames to look at, and what each should show: one entry per zoom phase that exists inside its clip."""
    ease = int(EASE * FPS)
    out = []
    for beat in p["beats"]:
        frames = int(round(beat["length"] * FPS))
        first, source_first = int(round(beat["start"] * FPS)), int(round(beat["from"] * FPS))
        for z in beat["zooms"]:
            a, b = int(z["start"] * FPS), int(z["end"] * FPS)
            hold = min(frames - 1, (a + max(a, b - ease)) // 2)
            for phase, frame, zoomed in (("start", a - ease - 3, False), ("hold", hold, True), ("end", b + 3, False)):
                if 0 <= frame < frames:
                    out.append({"beat": beat["id"], "mark": z.get("mark", ""), "phase": phase, "zoomed": zoomed, "scale": z["scale"], "x": z["x"], "y": z["y"],
                                "picture": beat["picture"], "frame": first + frame, "source_frame": source_first + frame})
    return out


def verify(video, p):
    """Compare the render with the plan. Returns one result per checked frame: {..., "seen", "ok", "flat"}."""
    results = []
    for c in checks(p):
        s = c["scale"]
        views = [(1.0, c["x"], c["y"]), (s, c["x"], c["y"])]
        if c["zoomed"]:
            views += [(max(1.0, s * k), c["x"], c["y"]) for k in NEAR if max(1.0, s * k) != 1.0]
            if abs(c["x"] - 0.5) + abs(c["y"] - 0.5) > 0.02:
                views.append((s, 0.5, 0.5))  # the right size about the wrong point: the frame centre
        got = render_frame(video, c["frame"])
        scores = [distance(got, view) for view in source_views(c["picture"], c["source_frame"], views)]
        best = min(range(len(views)), key=scores.__getitem__)
        flat = max(scores) - min(scores) < FLAT
        ok = flat or best == (1 if c["zoomed"] else 0)
        seen = "too little detail to tell" if flat else f"{views[best][0]:.2f}x" + (" about the frame centre" if best > 1 and views[best][1:] == (0.5, 0.5) else "")
        results.append({**{k: c[k] for k in ("beat", "mark", "phase", "frame")}, "want": f"{s:.2f}x" if c["zoomed"] else "1.00x", "seen": seen, "ok": ok, "flat": flat})
    return results


def summary(results):
    zooms = {(r["beat"], r["mark"]) for r in results}
    flat = sum(r["flat"] for r in results)
    return f"{len(zooms)} zoom{'s' if len(zooms) != 1 else ''} checked in the render ({len(results)} frames)" + (f"; {flat} frame{'s' if flat != 1 else ''} had too little detail to tell" if flat else "")


def require(video, p):
    """Raise if the render does not show the zooms in the plan; otherwise return a one-line summary for the log."""
    results = verify(video, p)
    bad = [r for r in results if not r["ok"]]
    if bad:
        lines = [f'  beat {r["beat"]}, zoom on "{r["mark"]}", {r["phase"]} (frame {r["frame"]}): wanted {r["want"]}, the render shows {r["seen"]}' for r in bad]
        raise RuntimeError("The render does not show the zooms the script asks for:\n" + "\n".join(lines))
    return summary(results)


def main():
    from edit_plan import plan
    slug, version = sys.argv[1], int(sys.argv[2])
    studio = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(studio, "guides.config.json"), encoding="utf-8") as f:
        media = os.path.expanduser(os.environ.get("GUIDES_MEDIA", json.load(f)["media"]))
    video = sys.argv[3] if len(sys.argv) > 3 else os.path.join(media, slug, "renders", f"{slug}-guide-v{version}.mp4")
    _, p = plan(slug, studio, media)
    results = verify(video, p)
    for r in results:
        print(f'{"ok  " if r["ok"] else "FAIL"}  beat {r["beat"]}  "{r["mark"]}"  {r["phase"]:5s}  frame {r["frame"]:<6d} wanted {r["want"]}  render shows {r["seen"]}')
    print(summary(results) if results else "This guide has no zooms.")
    sys.exit(0 if all(r["ok"] for r in results) else 1)


if __name__ == "__main__":
    main()

"""Create synthetic pipeline inputs and use the real offline planner. No Resolve installation needed."""
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from edit_plan import plan, publication_plan, word_time

studio, media = map(Path, sys.argv[1:3])
slug = "demo"

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))

words = [{"text": "Send,", "start": 1, "end": 1.5}, {"text": "follow-up", "start": 2, "end": 2.8}, {"text": "SEND!", "start": 4, "end": 4.5}]
assert [word_time(c, words) for c in ("send", "send#2", "followup", 0, 2.75)] == [1, 4, 2, 0, 2.75]
try:
    word_time("missing", words)
except ValueError:
    pass
else:
    raise AssertionError("missing cue accepted")

guide = {
    "slug": slug, "title": "Demo", "summary": "Synthetic guide", "position": 1, "asOf": "2026-11-06",
    "chapters": ["First"],
    "beats": [
        {"id": "g1", "graphic": {"kind": "Flow"}, "chapter": "First"},
        {"id": "s1", "shot": {"url": "/"}, "zoom": [{"mark": "button", "at": "send", "until": "send#2"}],
         "lower": {"title": "Send once", "at": "followup"}},
        {"id": "m1", "media": {"file": "existing.mp4", "from": 2}},
    ],
}
write(studio / "content/demo.json", guide)
for beat in guide["beats"]:
    write(media / slug / "vo" / f"{beat['id']}.json", {"say": "Send, follow-up SEND!", "seconds": 8, "words": words})
write(media / slug / "capture/s1.json", {"seconds": 9.39, "marks": {"button": {"x": 600, "y": 300, "w": 200, "h": 80}}})
manifest = {
    "g1": {"seconds": 9.3, "graphic": "g1.mov", "overlays": []},
    "s1": {"seconds": 9.3, "overlays": [{"file": "s1.mov", "start": 1.35, "end": 4.45, "label": "Send"}]},
    "m1": {"seconds": 9.3, "media": {"file": "existing.mp4", "from": 2}, "overlays": []},
}
write(media / slug / "graphics/manifest.json", manifest)
_, p = plan(slug, os.fspath(studio), os.fspath(media))
saved = publication_plan(p, 1, "Demo guide v1")
write(media / slug / "renders/demo-guide-v1.plan.json", saved)
print(json.dumps({"plan": p, "saved": saved}))

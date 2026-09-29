# The Resolve cut: how resolve_build.py works, and the traps

`scripts/resolve_build.py <page> <version>` drives DaVinci Resolve Studio through its external scripting API
(`DaVinciResolveScript`, run with the system Python; no time limit, unlike the Resolve MCP's 60-second calls). Resolve
must be open with Preferences > System > General > External scripting: Local.

## What it builds

In the project named by `resolve.project`, the timeline "<Page> guide v<version>" (1920×1080, 30 fps):

| Track | Contents |
| --- | --- |
| V1 | one clip per beat, back to back: the screen take (2880×1620, scaled to fit) or the rendered graphic |
| V2, V3 | callouts (ProRes 4444 with alpha), each on whichever of the two is free at that moment |
| V4 | lower thirds and chapter titles: real Text+ titles in the brand font, each wrapped as a compound clip |
| A1 | voice, one take per beat, starting 0.5 s into its beat, at `resolve.voiceDb` |
| A2 | the music bed at `music.db`, 1 s fade in, 3 s fade out, looped if the video is longer than the bed |

Chapter markers go on the timeline. Zooms are a Fusion Transform added to the V1 clip, keyframed about the element's
centre (scaling about an interior point keeps the frame covered). Then it renders H.264 1080p30 to
`<media>/<page>/renders/`, writes the beat layout to `.plan.json` (publish.mjs cuts the written guide's pictures with
it), exports the cut as DRT, FCPXML 1.10, OTIO and EDL to `<media>/<page>/timelines/`, exports the whole project as a
`.drp` to `<media>/resolve/`, and appends an entry to `<media>/<page>/EDIT-LOG.md`.

`--export-only` re-exports an existing version's cut without rebuilding.

## Traps, each found the hard way

- **`Timeline.InsertFusionTitleIntoTimeline` is an insert edit on V1.** It splits and ripples whatever is there,
  ignores empty upper tracks, and fails on locked tracks. So titles are built first in their own work timeline
  ("<Page> titles v<N>"), each wrapped with `CreateCompoundClip`, and the compound's media pool item is placed on V4
  with `AppendToTimeline(trackIndex=4, recordFrame=…)`.
- **`AppendToTimeline`'s `endFrame` is exclusive.** With `endFrame = n - 1` every clip is one frame short and black
  frames flash between beats. Lay beats out in whole frames and ask only for frames the file has.
- **Resolve keeps a clip's length and frames from its first import.** Re-voice a line or re-render a graphic under
  the same file name, import into the same bin, and the old clip is reused: lines get cut off, the title card shows
  old chapters. Each version imports into its own bin (`<Page>/v<N>/…`).
- **A new timeline can start at frame 0 or 01:00:00:00.** Always offset from `timeline.GetStartFrame()`.
- **A mono voice take on a stereo track plays about 3 dB hot.** Hence `voiceDb: -2` with takes levelled to −16 LUFS,
  which lands the mix near −15 LUFS integrated.
- **Text+ inputs for shading elements appear only after the element is enabled** (`Enabled2 = 1`), and an element
  left enabled draws an outline. The lower third sets `Enabled2 = 0` and builds its plate from a Background tool
  masked by a RectangleMask instead.
- **Fusion keyframes**: `tool.AddModifier("Blend", "BezierSpline")` (or `"XYPath"` for points), then
  `tool.SetInput(name, value, frame)`. Comp frame 0 is the start of the clip's source range.
- **Checking a frame without watching:** `project.ExportCurrentFrameAsStill(path)` after `timeline.SetCurrentTimecode`.

## Editing by hand

Open the timeline, edit, render from the Deliver page to the same renders path, then publish. Write the change in
`EDIT-LOG.md`: the next scripted build starts from the script and won't carry hand edits. For a change that should
last, put it in the script or in `resolve_build.py`.

## Recovering

Import the newest `.drp` in the Project Manager; or import one cut's `.drt` into any project (File > Import >
Timeline) and relink media to the production folder.

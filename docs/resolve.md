# The Resolve cut: how resolve_build.py works, and the traps

`scripts/resolve_build.py <page> <version>` drives DaVinci Resolve Studio through its external scripting API
(`DaVinciResolveScript`, run with the system Python; no time limit, unlike the Resolve MCP's 60-second calls). Resolve
must be open with Preferences > System > General > External scripting: Local.

## What it builds

In the project named by `resolve.project`, the timeline "<Page> guide v<version>" (1920×1080, 30 fps):

| Track | Contents |
| --- | --- |
| V1 | one clip per beat, back to back: the screen take (2880×1620, scaled to fit) or the rendered graphic |
| V2 upward | callouts (ProRes 4444 with alpha), each on a free track assigned by the offline planner |
| V4 or higher | lower thirds and chapter titles: real Text+ titles in the brand font, above every callout track |
| A1 | voice, one take per beat, starting 0.5 s into its beat, at `resolve.voiceDb` |
| A2 | the music bed at `music.db`, 1 s fade in, 3 s fade out, looped if the video is longer than the bed |

Chapter markers go on the timeline. Zooms are a Fusion Transform added to the V1 clip, keyframed about the element's
centre (scaling about an interior point keeps the frame covered). Then it renders H.264 1080p30 to
`<media>/<page>/renders/`, writes the beat layout to `.plan.json` (publish.mjs cuts the written guide's pictures with
it), exports the cut as DRT, FCPXML 1.10, OTIO and EDL to `<media>/<page>/timelines/`, exports the whole project as a
`.drp` to `<media>/resolve/`, and appends an entry to `<media>/<page>/EDIT-LOG.md`.

`--export-only` re-exports an existing version's cut without rebuilding.
For missing timeline or project backups, follow [archive recovery](resolve-recovery.md). Render completion and
archive completion are separate checks.

Ordinary cuts retain V2/V3 callouts and V4 titles. Three simultaneous callouts use V2/V3/V4 with titles on V5;
additional overlaps add tracks as needed. The planner allocates by the actual rounded frame ranges, including
callouts listed out of time order. See [callout allocation](architecture.md#dependencies-and-data-flow).
If Resolve rejects a required video track or callout insertion, the build stops before rendering and leaves its
reserved attempt for inspection; follow [render recovery](#render-completion-and-interrupted-attempts).

## Traps, each found the hard way

- **`Timeline.InsertFusionTitleIntoTimeline` is an insert edit on V1.** It splits and ripples whatever is there,
  ignores empty upper tracks, and fails on locked tracks. So titles are built first in their own work timeline
  ("<Page> titles v<N>"), each wrapped with `CreateCompoundClip`, and the compound's media pool item is placed on
  the planner's title track (V4 minimum) with `AppendToTimeline(trackIndex=…, recordFrame=…)`.
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
- **Resolve only sees fonts installed on the machine.** A web font in `brand.font` (loaded by Remotion from Google
  Fonts) makes the render fail at the first title with "The Fusion composition at … could not be processed
  successfully" (read it with `project.GetRenderJobStatus(job)`). Install the font, or set `brand.titleFont` to an
  installed one (Inter ships with macOS); the graphics keep `brand.font`.

## Editing by hand

Keep hand-edited exports separately and write the change in `EDIT-LOG.md`. Overwriting a verified render changes
its checksum, so the publisher rejects it. Put a lasting change in the script or `resolve_build.py`, then build a
new version through the scripted path. The next scripted build starts from the script and does not carry hand edits.

## Recovering

Import the newest `.drp` in the Project Manager; or import one cut's `.drt` into any project (File > Import >
Timeline) and relink media to the production folder.


## Render completion and interrupted attempts

Each build reserves `<media>/<page>/renders/.<page>-guide-v<N>.pending/` before changing the timeline.
Resolve writes its video into that directory. The builder checks format/settings acceptance, job creation/start,
`JobStatus: Complete`, and a nonempty regular output file. It then records the video's byte count and SHA-256 in
a schema 3 plan, exposes the final video without replacing an existing file, and exposes the plan last.
The publisher verifies that receipt before extracting or uploading assets. A completed job status and checksum
establish the render handoff; they do not replace playback and frame checks from [the quality checklist](quality.md).

`--no-render` builds the timeline and exports but saves `render.status: not_rendered`. That plan cannot publish.
Use a new version with rendering enabled when you need a publishable cut. Existing versions and attempt directories
are never reused automatically, including after an interruption.

For a failure before the final plan is committed, or if you interrupt Python:

1. Read the printed attempt path and its `job.json`, if job creation succeeded. Inspect that job in Resolve's
   Deliver page. Exiting Python does not stop Resolve; the script avoids the project-wide stop command.
2. Wait for the job to stop, or cancel that specific job in Resolve. Preserve the attempt directory and any
   partial video for diagnosis. A pending attempt has no final publication plan.
3. Fix the cause, then run `pnpm run cut <page> <next-version>` using an unused positive version number. Run only
   one builder against the same Resolve project at a time; the version reservation is not a project-wide lock.
4. Run `pnpm run publish <page> <next-version>` after the build succeeds, then perform the quality checks.

A process interruption between exposing the video and plan can leave a final video without a plan. Keep it as
recovery evidence and build a new version; the publisher cannot admit it without its plan. These file operations
protect against process interruption and conflicting version attempts, not every filesystem or power-loss failure.
Failed attempts and `--no-render` versions intentionally require a new version, rather than silently adopting an
unverified old file.

A project save/export failure happens after render commit and leaves the final video and plan in place.
Use [archive recovery](resolve-recovery.md#recover-the-project-backup) rather than rebuilding that version.

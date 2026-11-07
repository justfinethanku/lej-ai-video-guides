# Pipeline architecture

The kit is a sequence of command-line stages joined by files. Keep scripts and written guides in `content/`;
keep generated media under the configured media root. Each stage can be rerun independently when its inputs change.

## Dependencies and data flow

| Stage | Inputs | Outputs under the media root | Runtime boundary |
| --- | --- | --- | --- |
| `voice.mjs` | Guide beats, voice config | `<slug>/vo/<beat>.wav` and `.json` with duration and aligned words | ElevenLabs, ffmpeg and ffprobe |
| `capture.mjs` | Shot steps, voice timings | `<slug>/capture/<beat>.mp4` and `.json` with element boxes and events | Playwright, app session and ffmpeg |
| `graphics.mjs` | Graphic props, voice timings, captured boxes | `<slug>/graphics/*.mov` and `manifest.json` | Remotion bundler and renderer |
| `edit_plan.py` | Guide, voice timings, capture metadata, graphics manifest | Returns clip layout, callout track allocation, titles and markers to the caller | Python standard library; explicit studio and media roots |
| `resolve_build.py` | Edit plan and generated media | Versioned render, `.plan.json`, timeline exports and project export | DaVinci Resolve Studio scripting |
| `publish.mjs` | Versioned render and plan, written guide, guide metadata | Still images, loops, poster, video, captions and guide row | ffmpeg; folder copy or Supabase upload |

[`paths.mjs`](../scripts/paths.mjs) loads machine configuration and optional environment values for the Node CLIs.
[`browser.mjs`](../scripts/browser.mjs) owns Chromium discovery, borrowed session cookies and local static routing.
[`timing.mjs`](../scripts/timing.mjs) owns shared Node word-cue matching and narration lead/tail values. Capture and
graphics import it directly; using cue timing does not import a browser, renderer or machine configuration.
Python's `word_time` in the planner implements the matching used by Resolve titles and zooms.

The offline planner also owns callout track allocation. It compares each callout's rounded start frame and
rounded duration at 30 fps, assigns the first free video track from V2 upward, and returns `title_track` above
all callouts (V4 minimum). Touching frame ranges reuse a track; three simultaneous callouts use V2/V3/V4 and
move titles to V5. Allocation processes callouts in start-frame order while preserving the manifest's order
and metadata in the returned list. Invalid intervals and durations that round to zero frames fail during planning, before
the builder connects to Resolve or reserves an output version.

Allocation uses two minimum heaps: one releases tracks by end frame, and the other selects the lowest
free track number. Sorting and allocation take O(n log n) time for n callouts, with O(n) total planning
storage. This avoids rescanning every busy track on densely overlapping input while preserving exact
assignments. [Callout allocation measurements](overlay-performance.md) includes the benchmark and limits.

The Resolve builder consumes each overlay's `track` and the plan's `title_track`; it does not schedule callouts
again. A rejected video-track creation or callout insertion stops the build before rendering or committing
artifacts. The existing reserved-attempt recovery path retains evidence for the failed version.

The React files in `src/` are Remotion compositions. `src/theme.ts` reads the same config's brand fields at bundle
time. The files in `site-example/` are integration examples for a separate Next.js application; the kit's dependency
install and TypeScript check do not build that application.

## Render-plan contract

The graphics manifest describes the current working media. It is overwritten when graphics change.
The versioned `<slug>/renders/<slug>-guide-v<N>.plan.json` describes a particular cut.

New rendered cuts write `schema_version: 3`, along with `version`, `timeline`, total `seconds`, `beats`,
and a `render` receipt containing `status: complete`, the video basename, positive `bytes`, and `sha256`.
The builder stages output in a reserved attempt directory and exposes the plan only after the job completes.
The publisher checks the receipt before extraction or upload. A `--no-render` cut records `status: not_rendered`
and cannot publish. [Render recovery](resolve.md#render-completion-and-interrupted-attempts) describes interruption,
version ownership, and hand-edited export limits. The pure `publication_plan()` helper returns timing metadata;
the render builder adds the completion receipt when committing the artifacts.
Each saved beat contains:

- `id`: its script identifier.
- `start` and `length`: seconds within the finished video, aligned to the 30 fps edit.
- `vo_start`: absolute narration start in the final cut, including the lead-in.
- `narration`: take duration (`seconds`) and aligned `words` with text, start and end times.
- `publish.graphic`: whether the graphics manifest marks it as a full-frame graphic.
- `publish.overlays`: callout `start` and `end` times in seconds relative to the beat.

The publisher selects graphic stills near the end of the beat, screen stills during the first callout, and other
stills at 60% of the beat. These decisions use the metadata saved with that cut, so rebuilding graphics for a later
version does not change still selection for an earlier render. New plans do not need the working graphics manifest
at publish time.

Schema 1/2 plans remain supported with an explicit warning that completion and integrity are unverified.
Plans without `publish` fields remain supported through the current graphics manifest, with a warning
that still selection depends on that working file. Build a new cut version to create a snapshot; an old plan alone
cannot recover the graphics metadata that existed when it was rendered.

Plans without saved narration publish without captions (`captions_path: null`). Rebuild a new cut version to
include aligned captions; publishing never substitutes current voice timings for an older cut.

The snapshot covers extraction and caption timing. Publishing still reads the current `content/<slug>.json` and `.md` for guide
text and references; those files are not an archived copy of an earlier version's prose.

## Verify the file contracts

With project dependencies installed and Python 3 available, run the suite from the repository root:

```bash
pnpm test
```

The planner tests create synthetic guide, voice, capture and manifest files and check the resulting layout without
loading Resolve. Callout tests cover simultaneous overlays, frame rounding, unsorted input, unchanged two-track
layouts, and the actual builder with a recording synthetic Resolve SDK, including rejected track/clip operations.
These SDK fixtures verify requests and failure propagation; live Resolve placement and visual composition remain
unverified. The publishing tests run the real CLI in folder mode with a recording stand-in for ffmpeg, then
inspect extraction times and published files. They cover changed and missing working manifests and legacy plans.
They do not exercise media encoding, live application sessions, ElevenLabs, Resolve rendering or remote publishing.

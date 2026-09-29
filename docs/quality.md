# Checking a guide

## Before filming

- The page map covers every control, state and trap, with exact labels (from the code, checked against the live page).
- The person has agreed to anything filming creates or spends, and the script's `notes` say how to clean it up.
- The branch you film against is what production runs. Pages change under you: when another change lands mid-way,
  diff it (`git diff <old> <new> -- <page's code>`), fix the script and written guide, refilm the beats it touches,
  and publish the next version.

## After each step

| After | Check |
| --- | --- |
| voice | Durations look right; transcribe a take or two (ElevenLabs speech-to-text) for names and acronyms. |
| film | A frame from each take: the right screen, loaded, cursor on target. Any `FAILED` line names the step. |
| graphics | Composite one callout over its take (`ffmpeg … overlay`) and see the ring sit on the element. |
| cut | Frames at every chapter via `ExportCurrentFrameAsStill` or from the render; the title card lists the chapters; no black frames between beats. |
| render | `ffmpeg -i render.mp4 -af ebur128 -f null -` reads about −15 LUFS integrated; re-voiced lines play in full (transcribe the beat's span). |
| publish | Uploaded sizes match the local files. Open the Guides page signed in, expand every written guide, and confirm every picture and clip loads (a headless check: count `img.naturalWidth > 0` and `video.readyState > 0`). |

## After shipping

- The page is live on the production URL and reachable from the nav.
- Your runbook's record of what's live (page, version, length) and the edit logs are current.
- Every demo record filming created is cleaned up, by id.

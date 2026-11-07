# Recover missing Resolve archives

Use this procedure when a cut renders but its timeline exports or project backup are missing. A schema 3 render
receipt verifies the video handoff; it does not certify the archive files or prove that Resolve saved the project.
For a cancelled or interrupted render, start with [render attempt recovery](resolve.md#render-completion-and-interrupted-attempts).

## Identify the failed stage

Read the command's error and inspect the media folder before choosing a recovery:

| Observed state | Meaning | Recovery |
| --- | --- | --- |
| `Resolve rejected timeline export: …` with a `.pending` directory and no final plan | Rendering may have completed, but a timeline export failed before the publication artifacts were committed. Earlier archive formats may already exist. | Preserve the attempt and existing archives. Fix the export destination or Resolve error, then build an unused version. |
| `Resolve did not save the project` or `Resolve rejected project export: …` with a final video and plan | The render was committed before project save/export failed. `EDIT-LOG.md` has no new completion entry. | Save and back up the existing project in Resolve, then verify the committed render and archives. |
| Final video and plan exist, but a timeline archive was lost later | The render and archive have separate lifetimes. | Re-export the existing timeline as described below. |
| Final video exists without its final plan | Publication commit was interrupted. | Preserve the files and build an unused version; an archive re-export cannot reconstruct the receipt. |

The builder reports rejected timeline exports, project saves and project exports as errors. A successful SDK
return still needs file inspection and an import check. Builds made with older kit versions can have a blank or
partial `Timeline exports` line, or a claimed `Project export` path that was never written, despite exiting successfully.

## Re-export an existing timeline

You need the kit checkout and its `guides.config.json`, the existing Resolve project, the media folder, and Resolve
Studio running with local external scripting enabled. Stop other builders for that project. Preserve existing
timeline archives in a separate backup location first: this command uses the same output filenames and can replace them.

1. Confirm `resolve.project` selects the project that contains the cut. The command loads an existing project;
   it does not create one. It finds the timeline by the **current** `content/PAGE.json` title plus ` guide vVERSION`.
   If that title changed, use the existing timeline in Resolve's UI to export it, or work from a preserved copy of
   the matching script revision. Keep the current script changes intact.
2. From the kit root, re-export the version. For the demo's first cut, run:

   ```bash
   pnpm run cut requests 1 --export-only
   ```

   Replace `requests` and `1` with the page slug and existing version. The command writes
   `PAGE/timelines/PAGE-guide-vVERSION.{drt,fcpxml,otio,edl}` under the configured media folder
   (`GUIDES_MEDIA` overrides `media`). It stops at the first rejected format and names its path; files written
   before that failure remain. After correcting the cause, rerun the same export command.
3. Verify all four files with the check below. Re-import the DRT in a separate recovery project and check the
   timeline and media relinking. EDL carries V1 cuts only; use DRT for the Resolve cut with its titles and overlays.
4. Record the recovery and the actual archive paths in `EDIT-LOG.md`. `--export-only` does not append an entry.

`--export-only` exports the selected timeline's current state. It does not render, rebuild media, create a final
plan, update an existing render receipt, save the project, or export a `.drp`. It can archive a partial timeline,
so its success does not make a pending attempt publishable. Hand edits also do not become part of an existing
verified video; follow [editing by hand](resolve.md#editing-by-hand).

## Recover the project backup

If project save/export failed after render commit, keep the final video and plan unchanged. Save the project in
Resolve, then export a project backup to a new, explicit `.drp` path through Resolve's UI. Check the file and import
it into a separate recovery project before treating it as a usable backup. The scripted backup name contains the
project name and a timestamp to the minute; it is not a per-version archive or a no-clobber reservation.

An ordinary cut writes timeline exports, commits its video/plan, saves the project, exports the `.drp`, then appends
`EDIT-LOG.md`, in that order. Do not rerun an already committed version to repair a backup: version ownership rejects
the rebuild. A successful timeline re-export does not repair a failed project save or `.drp` export.

If timeline export failed **before** commit, keep the `.pending` directory, including `job.json` and any completed
video, as evidence. Follow the existing new-version procedure after inspecting the specific job in Resolve. Re-exporting
that timeline is useful for diagnosis but does not move its staged video into the publication path.

## Check archive files

From the kit root, run this read-only check with the media directory, page slug, version, and the exact `.drp` path
you exported. Replace the example paths and identifiers. A successful check prints five nonempty files; a missing
or empty file exits nonzero. This proves file presence and size, not archive validity, external-media inclusion,
or restore compatibility. Verify those by importing into a separate recovery project.

```bash
python3 - /absolute/path/to/media requests 1 /absolute/path/to/backup.drp <<'PY'
from pathlib import Path
import sys

media, page, version, backup = sys.argv[1:]
base = Path(media) / page / 'timelines' / f'{page}-guide-v{version}'
paths = [Path(f'{base}.{ext}') for ext in ('drt', 'fcpxml', 'otio', 'edl')]
paths.append(Path(backup))
for path in paths:
    if not path.is_file() or path.stat().st_size == 0:
        raise SystemExit(f'Missing or empty archive: {path}')
    print(f'{path}: {path.stat().st_size} bytes')
PY
```

## Rehearse without Resolve

From the kit root with Python 3 installed, run the offline recovery fixture:

```bash
python3 -B tests/export-recovery-fixture.py
```

Four grouped tests exercise the real builder with a recording SDK and tiny synthetic files in temporary directories.
They cover each rejected timeline format, new-version recovery with preserved evidence, project save/export failure
after render commit, missing project/title lookup, and archive re-export with unchanged video, plan, log, and backup.
The fixture never opens Resolve, generates real media, uses a paid provider, or publishes remotely. It verifies the
script's decisions; native export, archive import, and playback still require the operator checks above.

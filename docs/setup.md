# Set up the guide studio

Use this guide to install the kit, verify its local tools and identify the prerequisites for making a video.
Run commands from the repository root. The install commands are in the [README](../README.md#install).

## Prerequisites

- Node 20 or newer, pnpm, Python 3, ffmpeg and ffprobe on `PATH`.
- A writable media directory outside git. Set `media` in `guides.config.json` before generation.
- For narration: an ElevenLabs API key and access to the voice ID and model in `voice`.
- For generated music: access to the ElevenLabs Music API. You can instead supply your own music file or remove
  `music` from the config to omit the bed.
- For editing: DaVinci Resolve Studio running with external scripting set to **Local**, its scripting module
  importable by `python3`, and the configured title font installed on that machine.

The default config uses `demo-app/` through `serveDir`, `session.from: "none"` and folder publishing. This path needs
no app account or remote publishing credentials. Narration and generated music still call paid services; copying
this config does not provide provider access.

## Verify the installation

After copying the example config and installing dependencies, run the offline checks:

```bash
pnpm test
pnpm exec tsc --noEmit
```

Both commands should exit zero. The tests cover serving, narration recovery, edit planning, publication metadata
and upload transport with synthetic inputs. They do not prove live capture, provider access or Resolve rendering.
TypeScript checks `src/`; it needs `guides.config.json` because the theme imports it. It does not check
`site-example/`, which belongs in a separate Next.js application.

Start the included demo's HTTP server if you want to inspect its files independently of filming:

```bash
pnpm run demo
```

In another terminal, check the response:

```bash
curl --fail http://127.0.0.1:4400/
```

Expect HTML containing `Relay Desk`. Stop the server with Ctrl+C. Filming with `serveDir` does not need this server;
`pnpm run look /` and `pnpm run film requests` read the static files through browser interception.

Run the kit's prerequisites checker:

```bash
pnpm run doctor
```

Expect a line for each tool and prerequisite. Exit 1 means at least one failed check. Missing key, music and Resolve
are expected until you supply them. With no config, the command stops at the config-loading error before printing
the checklist. Copy `guides.config.example.json` first.

The doctor's media line only prints the configured path; verify that you can create a file there. Its Chromium
check uses the same executable as filming, checks that it exists, and launches and closes it headlessly with a
10-second launch timeout. Its voice request checks the voice endpoint,
not whether the configured synthesis model or Music API accepts a generation request. A successful checklist
therefore does not prove filming, graphics or editing will succeed.

Always use `pnpm run doctor` and `pnpm run publish`. `pnpm doctor` is pnpm's own diagnostic and can exit zero without
loading this project's config. `pnpm publish` invokes npm registry publishing. The explicit `run` selects the
scripts in this repository's `package.json`; see [pnpm's script resolution](https://pnpm.io/cli/run).

## Configure credentials and paths

Provide the variable named by `voice.keyEnv` (default `ELEVENLABS_API_KEY`) in the shell environment through your
credential manager. `scripts/paths.mjs` also reads an existing `.env` next to the config; an existing nonempty process
value takes precedence. Fleet operators obtain credentials through Fleet and its generated environment.

Use an absolute path or `~/…` for `media`. `GUIDES_MEDIA` overrides it for Node stages and the Resolve builder;
`GUIDES_SITE` overrides the Node filming URL. Put these overrides in the launching shell environment: the Python
Resolve builder does not load `.env`. Keep the same media root for every stage in a run.

For your live app, remove `serveDir` from the example config. Otherwise the browser continues intercepting the
configured site's requests and serving the local demo. Set `site`, and for cookie-based authentication set
`session.from: "chrome"` and `session.host` to the app hostname. On a supported machine, `pnpm run chrome` opens the
separate profile in `~/.guides-chrome`; sign in there. Capture copies cookies in memory. It does not copy local
storage or IndexedDB, so applications that store authentication only there need a different session integration.

The example music path is `music/bed-v1.mp3` relative to the media root. `pnpm run music` generates and overwrites
that file; it is not a cache check. Keep an approved bed under a different name before replacing it. Narration's
reuse and retry behavior is described in the [production runbook](runbook.md#steps).

## Platform limits

The original production path was macOS. The Nov 6, 2026 audit verified install and offline CLI behavior on
Ubuntu 24.04 ARM64 with Node 22.22.2, pnpm 10.33.2, Python 3.12.3 and ffmpeg 8.1. It did not verify a complete video
build on Linux or Windows.

Filming and the doctor use `chromium.executablePath()` from the installed, locked `playwright-core`, so the
browser revision and platform layout come from Playwright. `PLAYWRIGHT_BROWSERS_PATH` can select a custom cache;
set it to the same location for installation and filming. Install the matching browser with
`pnpm exec playwright-core install chromium`. The kit does not fall back to another cached revision or system
Chrome. See [Playwright's browser installation documentation](https://playwright.dev/docs/browsers#managing-browser-binaries).

On Nov 7, 2026, the doctor's headless launch, `pnpm run look /` and `pnpm run film requests q03` were verified on
Ubuntu 24.04 ARM64 (DGX Spark) with Playwright 1.63.0 and Chromium 1243. Filming used synthetic narration timings
and the local demo, with no paid generation. This verifies browser capture, not a complete video build.
**Windows is untested and unsupported by this kit.** `pnpm run chrome` invokes `google-chrome` on non-macOS
platforms, which must be installed separately; the signed-in profile workflow was not verified on Linux.

Remotion uses its own renderer/browser setup for graphics. Installing Playwright's Chromium does not establish
that Remotion rendering works. Resolve, the ElevenLabs APIs and real application sessions are separate checks.

## Recover a failed stage

- **Missing config or TypeScript cannot resolve the config:** copy the example config, then fill in your paths.
- **Doctor reports missing key:** check the variable name in `voice.keyEnv` and supply it in the process environment.
- **Browser missing or launch fails:** run `pnpm exec playwright-core install chromium` with the same
  `PLAYWRIGHT_BROWSERS_PATH` used for filming, then rerun `pnpm run doctor`. Check the reported path and launch
  error; an unrelated cached revision does not satisfy the installed Playwright.
- **Music missing:** supply the configured file, generate it with the paid API, or omit `music` from the config.
- **Resolve module import or connection fails:** open Studio, enable Local scripting, and check that the Python used
  by `pnpm run cut` can import `DaVinciResolveScript` from the installed scripting modules. See
  [Resolve recovery and rendering traps](resolve.md).
- **A media stage fails:** retain the last successful output and rerun that stage with the same media root.
  `voice`, `film` and `graphics` accept beat IDs after the page slug to select beats. Film and graphics rebuild the
  selected beats; narration skips complete matching takes. Use a new cut version after changing inputs so older
  timelines remain available. See [file contracts and version limits](architecture.md#render-plan-contract).
- **Publishing fails:** fix the missing render, plan, written guide or output access, then rerun
  `pnpm run publish requests 1` (replace the page and version for your guide). Folder mode writes to
  `<media>/requests/site/v1/`; it does not deploy a site. Remote publishing setup is in [publishing](publishing.md).

## Verification boundary

The audit executed the frozen install, Chromium download, offline tests, TypeScript, demo HTTP request and
`pnpm run publish requests 1` in folder mode with a synthetic four-second video and matching plan. The real
ffmpeg publisher produced nine files, rewrote image references and copied the video byte-for-byte. This checks the
local publication command; the fixture was not a Resolve render. The Nov 7 browser checks described in
[platform limits](#platform-limits) additionally exercised local demo screenshots and capture. Paid generation, real application sessions, Remotion rendering, Resolve and remote
publishing remain unverified.

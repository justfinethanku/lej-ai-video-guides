# Publishing and the Guides page

`scripts/publish.mjs <page> <version>` cuts the written guide's pictures from the render, then publishes by
`publish.type` in `guides.config.json`:

- **`supabase`**: uploads video, WebVTT captions, poster, stills and clips to a private Storage bucket under `<page>/v<version>/` and
  upserts one row per guide into a table. Credentials come from `publish.envFile` (`SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`). Files over 20 MB go through the resumable (TUS) endpoint in 6 MiB pieces read from
  disk as needed, resuming from the server's offset after a dropped connection. The publisher deletes an existing
  object before starting its replacement upload. Small uploads retry on dropped connections. The large-file
  uploader holds one source chunk rather than the whole video in memory;
  [upload measurements](upload-performance.md) cover the change and its limits.
- **`folder`**: writes the same files plus `guide.json` (the row) and `body.md` to `<media>/<page>/site/v<version>/`,
  for any site or CMS to serve.

In the written guide, `shot:`/`loop:` references become `asset:<page>/v<version>/<file>`. The site swaps each for a
real link when it renders.

## A ready Guides page (Next.js + Supabase)

`site-example/` is a working implementation from a production app, ready to adapt:

- `guides.sql`: the `guides` table (slug, position, title, summary, video/poster paths, running time, written guide
  Markdown, as-of date, version, hidden) with service-role RLS, and the private `guides` bucket.
- `guides.ts` (→ `lib/guides.ts`): loads the rows, signs every video, poster and `asset:` path in one batch call
  (12-hour links, so a paused video still plays), and resolves `asset:` links for the Markdown.
- `page.tsx` + `guides.css` (→ `app/guides/`): one section per guide with its title, summary, as-of date and length,
  the video with its poster, and the written guide in a `<details>` that starts closed. Pictures render as images and
  `.mp4` loops as silent autoplaying video.

Things this page gets right that are easy to get wrong:

- Keep the short `asset:` form in the Markdown and resolve it in the `img` component, with a `urlTransform` that lets
  `asset:` through. A signed URL built from an environment variable with a trailing line break breaks Markdown image
  parsing and shows raw `![…](…)` text; trim environment values used to build URLs.
- The page and the bucket stay behind the app's sign-in: the guides show real data.
- Add a nav link, and a dated "What's new" entry if the app has one.

## Deploying

Deploy the app through its own path from a commit that is on the main branch, and push it there. A deploy from a
commit main has moved past, or from a local branch nobody pushed, silently removes whatever it doesn't contain; on
the app this came from, a later deploy from an unpushed local branch took the Guides page down overnight.


## Verify the rendered cut

For schema 3 plans, publishing requires a completed render receipt whose version, filename, byte count, and
SHA-256 match the video. A mismatch stops before ffmpeg or any upload. Rebuild a new version after a failed,
cancelled, skipped, or changed render; do not edit the receipt to accept a partial file.
See [render completion and recovery](resolve.md#render-completion-and-interrupted-attempts).
Schema 1/2 plans retain compatibility with a warning; their historical completion cannot be proved from the plan.
The receipt detects changes before publication; keep the source render unchanged while publishing.

## Captions

Each new cut snapshots narration text, duration, aligned words and the absolute `vo_start` of each beat.
Publication adds each word's take-relative time to `vo_start`, which already includes the half-second lead-in.
It groups words into sentences or lines of at most 42 characters and up to 7 seconds, holding short phrases
for about a second where the next cue permits. A saved music bed adds `[Music]` for intros and outros of at
least a second. Audio from screen recordings is not inferred.

The publisher validates alignment before extraction or upload. Plans without alignment must be rebuilt as a
new cut version; reading current voice metadata could put new narration over an old video. The caption file is
`<page>/v<version>/<page>-guide-v<version>.vtt` beside the video, with `captions_path` in the guide row.
Publishing a different version leaves earlier caption objects in place.

For an existing site, add a nullable `captions_path text` column to its `guides` table through that app's migration
process before updating the publisher and loader. The example schema includes it for new installations.
The loader signs captions in the same batch as the video; the player exposes a default English track.
The video uses `crossOrigin="anonymous"` so signed caption URLs can load from Storage. Allow the app origin
in the media host's CORS configuration.

## Verify caption playback

Use a scratch copy of the kit with dependencies and Playwright Chromium installed. Set `guides.config.json`
to folder publication, a scratch media directory, `session.from: "none"`, `site: "http://caption-playback.test"`,
and omit `serveDir`. Run the opt-in check from the kit root:

```bash
node tests/captions-playback.mjs out/caption-screens
```

The check creates a 12-second synthetic video with ffmpeg, publishes a two-beat fixture through the real folder
publisher, and loads the server-rendered example page with intercepted local assets. It uses `openSite()` and
Playwright's Chromium, checks English track discovery and selection, seeks around both narration offsets,
plays across the second cue boundary, and saves `english-captions.png` with native captions visible.
It needs no credentials, paid generation, app server, Resolve or GPU. Supabase upload and signing are tested
with intercepted requests in `pnpm test`; this playback check does not contact a live backend.

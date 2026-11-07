# Guides page example (Next.js App Router + Supabase)

A working Guides page: one section per page of your app, each with its title, summary, "as of" date and length, the
narrated video, and the written guide folded underneath (a native `<details>`, closed until clicked).

| File | Goes to | What it does |
| --- | --- | --- |
| `guides.sql` | a migration | the `guides` table and the private `guides` Storage bucket |
| `guides.ts` | `lib/guides.ts` | loads the rows and signs every video, poster and picture for 12 hours in one call |
| `supabase-rest.ts` | `lib/supabase-rest.ts` | the minimal server-side database call `guides.ts` uses |
| `page.tsx`, `GuideVideo.tsx`, `guides.css` | `app/guides/` | the server page and client media-recovery controls |

Adapt two imports in `page.tsx`: your app's signed-in check (the page shows real screens, so keep it behind your
login) and the path to `guides.ts`. Needs `react-markdown` and `remark-gfm`. Publish with `publish.type: "supabase"`
in `guides.config.json`; the kit fills the table and the bucket.

## Accessibility

Motion clips in the written guide start paused and have native playback controls. Their Markdown alternative text
names the clip; use a description of the demonstrated action. Each narrated video and written-guide disclosure
includes the guide title in its accessible name. The CSS supplies visible keyboard focus; check the host app's
text, link and focus colors against its actual backgrounds.

Copy `GuideVideo.tsx` alongside the page. After hydration, a failed video displays a named, polite status and a
**Retry video** button. Retry reloads the same media URL and stays paused. Once the media can play, the status
reports readiness; the button remains mounted to preserve keyboard focus. Narrated videos with written content
also offer **Open written guide**, which opens and focuses that guide's disclosure. A failed motion clip has its
own status and retry control. Reload the page if a signed media link has expired; retry does not renew it.
The player checks for an existing media error when it mounts, but these recovery controls require JavaScript.
Changing the video URL resets its recovery state. The controls wrap and their text breaks at narrow widths;
they add no automatic motion, and reduced-motion preferences disable the disclosure-arrow transition.

The narrated player exposes a default **English** caption track from the guide's signed `captions_path`.
Publish a new cut to snapshot word alignment and produce its versioned WebVTT file. Existing installations need
the nullable `captions_path text` column added to `guides` before using the updated publisher and loader;
`guides.sql` includes it for new installations. Existing rows can leave it null until re-cut.
Allow anonymous CORS requests from the app origin to the signed video and caption URLs.

`pnpm test` includes DOM interaction checks for the demo, server rendering of this page, and real React media-event
handlers with synthetic guide data. Media events and reload outcomes are injected; no decoding or native playback
is verified by those tests. The opt-in caption playback check described in
[publishing](../docs/publishing.md#verify-caption-playback) decodes synthetic media in the kit's Chromium.
Axe checks the demo's DOM rules; contrast is checked against its declared
palette. These checks do not measure layout or screen-reader output. In the integrated app, also check keyboard
play/pause, failed-media retry and written-guide focus, 320-pixel reflow, reduced motion, and screen-reader
announcements in a real browser. Check the demo's modal Escape and Tab containment separately.

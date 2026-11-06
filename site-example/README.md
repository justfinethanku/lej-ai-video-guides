# Guides page example (Next.js App Router + Supabase)

A working Guides page: one section per page of your app, each with its title, summary, "as of" date and length, the
narrated video, and the written guide folded underneath (a native `<details>`, closed until clicked).

| File | Goes to | What it does |
| --- | --- | --- |
| `guides.sql` | a migration | the `guides` table and the private `guides` Storage bucket |
| `guides.ts` | `lib/guides.ts` | loads the rows and signs every video, poster and picture for 12 hours in one call |
| `supabase-rest.ts` | `lib/supabase-rest.ts` | the minimal server-side database call `guides.ts` uses |
| `page.tsx`, `guides.css` | `app/guides/` | the page |

Adapt two imports in `page.tsx`: your app's signed-in check (the page shows real screens, so keep it behind your
login) and the path to `guides.ts`. Needs `react-markdown` and `remark-gfm`. Publish with `publish.type: "supabase"`
in `guides.config.json`; the kit fills the table and the bucket.

## Accessibility

Motion clips in the written guide start paused and have native playback controls. Their Markdown alternative text
names the clip; use a description of the demonstrated action. Each narrated video and written-guide disclosure
includes the guide title in its accessible name. The CSS supplies visible keyboard focus; check the host app's
text, link and focus colors against its actual backgrounds.

The kit does not yet publish synchronized captions for narration; this is tracked in
[LEJ-527](https://linear.app/contentionmedia/issue/LEJ-527). The written guide is available separately, but it is not
a synchronized transcript. Supply and verify captions when integrating narrated media.

`pnpm test` includes DOM interaction checks for the demo and server rendering of this page through React and
Markdown with synthetic guide data. Axe checks the demo's DOM rules; contrast is checked against its declared
palette. These checks do not measure layout or screen-reader output. In the integrated app, also check keyboard
play/pause, modal Escape and Tab containment, 320-pixel reflow and screen-reader announcements in a real browser.

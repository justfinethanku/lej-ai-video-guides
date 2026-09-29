# Publishing and the Guides page

`scripts/publish.mjs <page> <version>` cuts the written guide's pictures from the render, then publishes by
`publish.type` in `guides.config.json`:

- **`supabase`**: uploads video, poster, stills and clips to a private Storage bucket under `<page>/v<version>/` and
  upserts one row per guide into a table. Credentials come from `publish.envFile` (`SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`). Files over 20 MB go through the resumable (TUS) endpoint in 6 MB pieces, resuming from
  the server's offset after a dropped connection; an existing object is deleted first, because TUS answers 409 to a
  replace even with `x-upsert`. Small uploads retry on dropped connections.
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

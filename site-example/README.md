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

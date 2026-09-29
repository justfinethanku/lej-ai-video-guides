---
name: app-guide-videos
description: Make narrated video guides and written guides for the pages of a web app with the lej-ai-video-guides kit (github.com/justfinethanku/lej-ai-video-guides), filmed on the live app, voiced with ElevenLabs Eleven v4, with Remotion motion graphics and a real edit in DaVinci Resolve Studio, then published and kept current as the app changes. Use when asked for guides, tutorials, walkthrough or help videos, "a video for each page", or to update a guide after the app changed.
---

# App guide videos

A guide is one page of an app explained two ways: a narrated video that shows the page being used, and a written
guide with every button, trap and step, illustrated with stills and short clips cut from the video. The kit
makes both from a script, so a guide can be re-cut in an hour when the page changes.

The kit is the repo github.com/justfinethanku/lej-ai-video-guides: clone it (or find the existing clone in the
project as `guides-studio/`). Its `docs/` folder has the script format, the Resolve cut and its traps, publishing,
and the checking list; read the one each step points to. The repo's Relay Desk demo (`content/requests.json`) is a
complete example script.

<approach>
The measure of a guide is whether the viewer can do the work afterwards. Every sentence of narration names something
on screen by the exact label the app shows, says what it does, and says what can't be undone or what costs money.
Length follows the page: a simple page runs four minutes, a workflow with a dozen decisions runs nine.

Work in this order, because each step feeds the next: map the page from its code, write the script, voice it, film to
the voice, draw the graphics from the film, cut in Resolve, publish, check. Film the live app with the person's real
data when they say so; otherwise film a demo account. Anything filming creates in the app (a record, a draft, a paid
AI call) is agreed with the person first and cleaned up afterwards by its id.

Talk to the person in short check-ins: what you're doing now, what you found, what you need from them. Ask the
decisions that are theirs in one batch, each with a recommended option: real data or demo data; where videos are
hosted; which pages; which voice; whether filming may create records or spend money; deploy when done or review
first. Propose the page list and the chapter list for each guide yourself and let them correct it.
</approach>

<instructions>
1. **Set up the kit.** Clone the kit, or copy it into the project repo as `guides-studio/` (scripts belong in git; media does not).
   Copy `guides.config.example.json` to `guides.config.json` and fill in: product name, site URL, how to sign in
   (`session.from: "chrome"` borrows a signed-in Chrome profile opened with `pnpm chrome`; `"none"` for public pages; `serveDir` films a static folder with no server),
   production media folder (outside git), ElevenLabs voice id and model, brand colours, font and logo files (put the
   images in `public/`), music bed file, Resolve project name, and where to publish (`"supabase"` or
   `"folder"`). Run `pnpm install`. Exclude `guides-studio/` from the app's build (tsconfig `exclude`, `.vercelignore`
   or equivalent) and add `guides-studio/node_modules/` and `guides-studio/out/` to `.gitignore`.
   Tools needed on the machine: ffmpeg, Playwright Chromium, DaVinci Resolve Studio with Preferences > System > General
   > External scripting set to Local, and the ElevenLabs key in `.env`. `pnpm doctor` checks all of it.

2. **Map each page from its code.** For each page, send a subagent to read every file behind it and return: every
   screen and URL parameter; every control top to bottom with its exact on-screen label and what it does, including
   side effects (writes data, sends, calls AI, costs money, can't be undone); every status and empty state; the
   end-to-end task flow; what a user needs to know to use it safely; and anything unfinished or dev-only. Quote
   UI strings with file:line. Then look at the live page (`pnpm look /path`) to see what the data makes of
   the layout.

3. **Write the script** in `content/<page>.json` (format: `docs/script-format.md`). Open with a title card and a
   flow diagram of how the page works, then one chapter per task, then a short wrap-up. One idea per beat. Each screen
   action lands on the word that names it (`"at": "Send"`). Callouts name a thing and say what to do with it; a lower
   third states a rule worth remembering ("8 seconds to undo"). Say what is irreversible and what costs money, in the
   beat where the viewer would press it.

4. **Voice it.** `pnpm voice <page>`. One WAV per beat with word timings, levelled to −16 LUFS; beats
   whose text is unchanged are skipped. Spot-check pronunciation of names and acronyms by transcribing a take with
   ElevenLabs speech-to-text. Generate the music bed once per product (`pnpm music`) and confirm it has no vocals by transcribing a slice.

5. **Film it.** `pnpm film <page>`. A headless browser at 2× films each beat on the live app in time
   with its voice, with a drawn cursor, and records the box of every element the script points at. Read a frame from
   each take (`ffmpeg -ss <t> -i take.mp4 -frames:v 1`) and refilm any beat whose selector missed or whose page was
   still loading (put waits and warm-ups in the beat's `prep`, which runs before filming starts).

6. **Draw the graphics.** `pnpm graphics <page>`. Remotion renders the title card, flow diagrams and every
   callout (ProRes 4444 with transparency) in the brand's look, timed from the voice and placed from the recorded
   boxes.

7. **Cut it in Resolve.** `pnpm cut <page> <version>`. Builds the timeline, adds Text+ lower
   thirds and chapter titles, chapter markers, zooms, voice and music, renders H.264 1080p, exports the project
   (`.drp`) and the cut (DRT, FCPXML, OTIO, EDL), and appends to the page's `EDIT-LOG.md`. How it works and the traps: `docs/resolve.md`.

8. **Write the written guide** in `content/<page>.md`: the same page as numbered steps at the moment of action, every
   control and trap from the map (including those the video skips), calm heads-ups as quotes next to what they're
   about. Illustrate with `![alt](shot:<beat>)` (a still from the finished video with its callout) and
   `![alt](loop:<beat>)` (that beat as a silent looping clip).

9. **Publish.** `pnpm publish <page> <version>`. Cuts the stills and clips from the render and publishes
   the video, poster, pictures and written guide (`docs/publishing.md`, including a ready Guides page for
   Next.js + Supabase in `site-example/`).

10. **Check it** with `docs/quality.md`: frames at every chapter, callouts on their targets, loudness, full
    re-voiced lines, the live page signed in with every picture loading. Deploy the site through the project's own
    deploy path from a commit that is on the main branch, so the next deploy keeps the page.

11. **Leave it maintainable.** Write the project's runbook (the
    standing update rule, where everything lives, what's live now, recipes for common changes, recovery, QA). Add the
    standing rule to the project's CLAUDE.md: a change to a page with a guide updates its guide and video in the same
    work. Put a README in the media folder.
</instructions>

<output>
For each page: a published video (title card, flow diagram, chapters with titles and markers, callouts on every
control named, lower thirds for the rules, voice at about −15 LUFS integrated over a quiet music bed) and a written
guide on the Guides page, collapsed under the video. In the project: `guides-studio/` with `guides.config.json` and
`content/<page>.{json,md}`; a runbook; the CLAUDE.md rule. In the media folder: voice, captures, graphics, renders,
timeline exports, `EDIT-LOG.md` per page, Resolve project exports. In Resolve: one project with one timeline per page
per version. A short report to the person: what's live with lengths, what filming created and how it was cleaned up,
anything the mapping found that the app gets wrong, and anything that went wrong on the way.
</output>

<example>
A beat that works: the viewer hears "To send one email, press Send on its card", the cursor reaches Send on the word
"Send", a ring and a label reading "Send one" appear on it, and the next line says "Send all doesn't ask you to
confirm, so read the stack first" while a second label marks Send all with "No confirm step: read the stack first".

A beat that doesn't: "This is where you can manage your outreach efficiently" over a still screen. It names nothing
on screen, gives the viewer nothing to do, and leaves out the one thing that can't be undone.
</example>

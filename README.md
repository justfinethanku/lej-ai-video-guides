# LEJ AI Video Guides

Narrated video guides for your web app, made from a script and re-made in an hour when the app changes.

For each page of your app you get:

- **A narrated video** filmed on the live app: a title card, a diagram of how the page works, then the page in use with
  a cursor, callouts on every control the narration names, lower thirds for the rules worth remembering, chapter
  titles, and a quiet music bed. The narration and the screen stay in sync because every click is timed to the word
  that names it.
- **A written guide** with every button, step and trap, illustrated with stills and short silent clips cut from the
  finished video.
- **A real edit** in DaVinci Resolve Studio: one timeline per page per version, with every title, callout and clip on
  its own track, exported as DRT, FCPXML, OTIO and EDL so you can finish it in Resolve, Final Cut Pro or Premiere Pro.

The whole thing is driven by one script file per page. Change a line, and only that line is re-voiced; refilm one
beat, and only that beat is refilmed; rebuild, and the edit, the render, the written guide's pictures and the
published page all follow.

The how-to, with videos: **[limitededitionjonathan.com/ai-video-guides](https://limitededitionjonathan.com/ai-video-guides)**.
Step-by-step setup: **[limitededitionjonathan.com/connect/ai-video-guides-install](https://limitededitionjonathan.com/connect/ai-video-guides-install)**.

## Who this is for

People who make professional video and want it to be repeatable. You need:

- **DaVinci Resolve Studio** (the paid version, about $295, one-time). The free version of Resolve has no external
  scripting, and the edit is built through it. The cut exports to FCPXML and OTIO for finishing in Final Cut Pro or
  Premiere Pro, but Resolve Studio builds it.
- **An ElevenLabs account** for the voice (Eleven v4) and the music bed. The paid Starter tier or above; a four-minute
  guide uses roughly 4,000 characters.
- A Mac (tested) or Linux/Windows machine with **Node 20+**, **ffmpeg**, **Python 3** and **pnpm**.

## Install

```bash
git clone https://github.com/justfinethanku/lej-ai-video-guides.git
cd lej-ai-video-guides
pnpm install
npx playwright-core install chromium
cp guides.config.example.json guides.config.json
echo "ELEVENLABS_API_KEY=your-key-here" > .env
```

In DaVinci Resolve Studio: **Preferences > System > General > External scripting using: Local**, then restart Resolve.

```bash
pnpm music      # makes the music bed (about 8 minutes of quiet instrumental)
pnpm doctor     # checks everything, says what to fix
```

## Your first guide: the demo

The repo includes **Relay Desk**, a small made-up support app in `demo-app/`, and a finished script for its Requests
page in `content/requests.json`. The example config films it with no server running. With Resolve open:

```bash
pnpm voice requests        # narration, one take per beat, with word timings
pnpm film requests         # films each beat in time with its narration
pnpm graphics requests     # title card, flow diagram and callouts (Remotion)
pnpm cut requests 1        # builds, renders and exports the edit in Resolve
pnpm publish requests 1    # the video, poster, written guide and its pictures
```

The finished video is in your media folder under `requests/renders/`, the timeline is in the Resolve project
"Relay Desk Guides", and the publishable guide is in `requests/site/v1/`.

## Your app

1. Edit `guides.config.json`: product name, site URL, brand colours, font and logo (put the image in `public/`), the
   ElevenLabs voice, the media folder, and where to publish.
2. If your app needs a sign-in, set `"session": {"from": "chrome"}`, run `pnpm chrome`, and sign in to your app in the
   window that opens. Filming borrows that profile's session; it never types a password and leaves your Chrome alone.
3. Map a page before you write about it: every control with its exact label, what it does, what can't be undone and
   what costs money. `pnpm look /your/page` takes a screenshot at filming size.
4. Write `content/<page>.json` (format: [docs/script-format.md](docs/script-format.md)) and `content/<page>.md` (the
   written guide), then run the five commands above.

When the page changes: fix the script, re-run the five commands with the next version number. Old versions stay in
the Resolve project as history.

## Publishing

`publish.type` in the config:

- `"folder"`: the video, poster, pictures, `guide.json` and `body.md` in a folder, for any site or CMS.
- `"supabase"`: a private Storage bucket plus a `guides` table, with a ready Guides page for Next.js in
  [site-example/](site-example/).

## How it works

| Step | Tool | What happens |
| --- | --- | --- |
| Script | `content/<page>.json` | Beats: what is said, what is shown, which words trigger which clicks, callouts, lower thirds and chapters. |
| Voice | ElevenLabs Eleven v4 | One WAV per beat with word timings, levelled to −16 LUFS. Unchanged lines are skipped. |
| Film | Playwright + Chromium | A headless browser at 2× films each beat on the live app, arriving on each control as its name is spoken, and records every element's box. |
| Graphics | Remotion | Title card, flow diagrams and callouts (ProRes 4444 with transparency) in your brand, placed from the recorded boxes. |
| Edit | DaVinci Resolve Studio | V1 picture, V2–V3 callouts, V4 Text+ lower thirds and chapter titles, A1 voice, A2 music, chapter markers, zooms; renders H.264, exports DRT/FCPXML/OTIO/EDL and the project. |
| Publish | ffmpeg + your site | Stills and loops for the written guide cut from the render; video and guide published. |

More: [docs/resolve.md](docs/resolve.md) (the edit, and the Resolve API traps it works around),
[docs/publishing.md](docs/publishing.md), [docs/quality.md](docs/quality.md) (checking a guide),
[docs/runbook.md](docs/runbook.md) (the whole process, start to finish).

## With Claude Code

[skill/SKILL.md](skill/SKILL.md) is a Claude Code skill that runs this whole process: copy the `skill/` folder to
`~/.claude/skills/app-guide-videos/` and ask for "a video guide for each page".

## License

MIT. Made by [Jonathan Edwards](https://limitededitionjonathan.com).

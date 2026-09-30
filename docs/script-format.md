# Script format: content/<page>.json

One file per page. `content/requests.json` (the Relay Desk demo) is a complete, filmed example of a
read-only page. For a page whose filming creates records (a draft, a batch, a paid AI call), say so in `notes` and clean up by id afterwards.

```json
{
  "slug": "mail",                       // file names, bucket paths, the anchor on the Guides page
  "position": 4,                        // order on the Guides page, low first
  "title": "Mail",                      // the page's name exactly as the app's nav shows it
  "summary": "One sentence: what the page is for.",
  "asOf": "2026-09-28",                 // the day the guide matched the page; shown on the page and the title card
  "chapters": ["How Mail works", "Owed replies", "..."],   // listed on the title card; each starts with a "chapter" beat
  "notes": "What filming creates in the app and how to clean it up (by id).",
  "beats": [ ... ]
}
```

## A beat

Every beat has an `id` (unique, short: `m01`, `f11r`) and `say` (the narration). Then exactly one of:

- `"graphic": {"kind": "TitleCard"}`: the opening card (product, page, summary, chapters, as-of date).
- `"graphic": {"kind": "Flow", "props": {"heading": "...", "steps": [{"title": "...", "text": "..."}]}, "cues": ["word", ...]}`:
  a diagram whose steps appear as the narration says each cue word.
- `"graphic": {"kind": "<Composition>", "props": {...}, "cues": ["word", ...]}`: any other Remotion composition you
  register in `src/Root.tsx` (a mock of another app, a terminal, a closing card). It gets the script's `props`, plus
  `cues` (the frame each cue word is said) and `frames` (the beat's length), so it can time itself to the voice.
- `"shot": {...}`: the live app, filmed in time with the narration.

Optional on any beat:

- `"chapter": "Owed replies"`: this beat starts a chapter (chapter title lower third + timeline marker).
- `"lower": {"title": "8 seconds to undo", "text": "Then the email is gone", "at": "eight"}`: a lower third from that word.
- `"callouts": [{"mark": "<name>", "label": "Send one", "note": "optional second line", "at": "Send", "until": "all", "side": "top|bottom|left|right", "dim": true}]`:
  a ring and label on a recorded element from one word to another (or to the beat's end). `dim: true` darkens
  everything else; use `false` when several things are pointed at in a row.
- `"zoom": [{"mark": "<name>", "at": "word", "until": "word", "scale": 1.5}]`: push in on an element. Keep zooms and
  callouts at different moments: callout positions are drawn for the unzoomed frame.

## A shot

```json
"shot": {
  "url": "/mail",                 // where to start
  "continue": true,               // start from where the previous beat's take left the page (url is the fallback)
  "settle": 3000,                 // ms to wait after loading before filming
  "prep": [ steps ],              // unfilmed setup: waiting for AI drafts, warming a slow file, opening a menu
  "steps": [ steps ],             // filmed, each landing on its "at" word
  "min": 20                       // optional minimum take length in seconds
}
```

Steps (each may have `"at": "<word>"`, `"<word>#2"` for its second time, or a number of seconds; `"name"` names the
recorded box for callouts and zooms, defaulting to the selector):

| Step | Does |
| --- | --- |
| `{"click": sel}` | glides the cursor there (arriving on the word) and clicks |
| `{"hover": sel}` / `{"move": sel}` | glides there and rests (hover states show) |
| `{"into": sel, "type": "text", "delay": 45}` | clicks the field and types |
| `{"type": "text"}` | types wherever the caret already is (click the field, `{"press": "ControlOrMeta+End"}`, then type to add to the end) |
| `{"press": "Escape"}` | a key; `ControlOrMeta+A` works |
| `{"scroll": 600, "over": sel}` | a smooth wheel scroll over an element |
| `{"wait": ms}` / `{"waitFor": sel}` / `{"waitGone": sel}` | wait for time, for something to appear, or to go away |
| `{"goto": "/path"}` | navigate |
| `{"top": sel, "offset": 16}` | jumps an element to the top of the view, `offset` px below the edge; instant, so use it in `prep` |
| `{"mark": "name", "sel": sel}` | record an element's box without moving the cursor |
| `{"still": "name", "sel": sel, "pad": 16}` | a PNG of the page (or of one element) |

Selectors are Playwright selectors (`text=…`, `role=button[name="…"]`, CSS with `:has-text("…")`); the first match is
used, so scope them (`.cards > li:first-child …`) and prefer a stable row (`tbody tr:has-text("Test batch")`) over
`first-child` on live data that changes.

Word matching ignores case and punctuation, and hyphenated words join ("follow-up" → `followup`). A word the
narration doesn't say stops the filming of that beat with an error naming it.

## Writing the narration

- One idea per beat, 10–30 seconds. Short sentences; second person.
- Name controls by their exact label, in the order the eye finds them.
- The first time the page does something that can't be undone or costs money, say so in that beat.
- Spell out what TTS mispronounces ("Series Three" for "III").
- The title card and the last beat point to the written guide for the details the video leaves out.

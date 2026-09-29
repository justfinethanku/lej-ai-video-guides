// Motion graphics for one guide, rendered with Remotion (src/): the title card, the flow diagrams, and every callout.
//   node scripts/graphics.mjs <slug> [beatId ...]
// Needs voice.mjs (word timings) and capture.mjs (element boxes) first. Callouts render as ProRes 4444 with alpha, to
// sit on V2 over the screen recording in Resolve; full-frame graphics render as ProRes 422. Everything is timed from
// the narration, and graphics/manifest.json records where each piece goes inside its beat (resolve.py reads it).
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { atSeconds } from "./capture.mjs";
import { FPS, MEDIA, media, script, STUDIO } from "./paths.mjs";

export const LEAD = 0.5;
export const TAIL = 0.8;

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
// A path in a script: absolute, ~/…, or relative to the media folder.
const mediaPath = (p) => (p.startsWith("~/") ? join(process.env.HOME, p.slice(2)) : isAbsolute(p) ? p : join(MEDIA, p));
const asOf = (d) => `As of ${new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;

/** Seconds from the start of a beat's clip at which a callout shows and hides. */
export function calloutSpan(c, words, beatSeconds) {
  const start = Math.max(0, LEAD + atSeconds(c.at, words) - 0.15);
  const end = c.until ? LEAD + atSeconds(c.until, words) - 0.05 : beatSeconds - 0.25;
  return { start: +start.toFixed(3), end: +Math.max(start + 0.8, end).toFixed(3) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [slug, ...only] = process.argv.slice(2);
  const guide = script(slug);
  // Still graphics show an image file: copy each into public/.stills/ so the bundle can serve it.
  mkdirSync(join(STUDIO, "public", ".stills"), { recursive: true });
  for (const beat of guide.beats) {
    if (beat.graphic?.kind !== "Still") continue;
    const from = mediaPath(beat.graphic.props.src);
    copyFileSync(from, join(STUDIO, "public", ".stills", basename(from)));
  }
  const serveUrl = await bundle({ entryPoint: join(STUDIO, "src/index.ts") });
  const manifestPath = media(slug, "graphics", "manifest.json");
  const manifest = existsSync(manifestPath) ? read(manifestPath) : {};

  const render = async (id, props, out, alpha) => {
    const inputProps = { ...props };
    const composition = await selectComposition({ serveUrl, id, inputProps });
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      outputLocation: out,
      codec: "prores",
      proResProfile: alpha ? "4444" : "hq",
      imageFormat: alpha ? "png" : "jpeg",
      pixelFormat: alpha ? "yuva444p10le" : "yuv422p10le",
      muted: true,
      logLevel: "error",
    });
  };

  for (const beat of guide.beats) {
    if (only.length && !only.includes(beat.id)) continue;
    const vo = read(media(slug, "vo", `${beat.id}.json`));
    const seconds = LEAD + vo.seconds + TAIL;
    const entry = { seconds: +seconds.toFixed(3), overlays: [] };

    if (beat.media) {
      // An existing video (a finished guide, a screen recording) placed as-is; resolve_build.py cuts it in.
      const file = mediaPath(beat.media.file);
      if (!existsSync(file)) throw new Error(`${beat.id}: media ${file} not found`);
      entry.media = { file, from: beat.media.from ?? 0 };
    }
    if (beat.graphic) {
      const frames = Math.round(seconds * FPS);
      let props;
      if (beat.graphic.kind === "Still") props = { ...beat.graphic.props, src: `.stills/${basename(beat.graphic.props.src)}`, frames };
      if (beat.graphic.kind === "TitleCard") props = { page: guide.title, purpose: guide.summary, chapters: guide.chapters, asOf: asOf(guide.asOf), frames };
      if (beat.graphic.kind === "Flow") {
        const cues = (beat.graphic.cues ?? []).map((w) => Math.round((LEAD + atSeconds(w, vo.words)) * FPS));
        props = { ...beat.graphic.props, cues, frames };
        // A still of the finished diagram for the written guide.
        const composition = await selectComposition({ serveUrl, id: "Flow", inputProps: { ...props, still: true } });
        await renderStill({ serveUrl, composition, inputProps: { ...props, still: true }, output: media(slug, "stills", `${beat.id}-flow.png`), frame: 0, logLevel: "error" });
      }
      const out = media(slug, "graphics", `${beat.id}-${beat.graphic.kind}.mov`);
      await render(beat.graphic.kind, props, out, false);
      entry.graphic = out;
    }

    if (beat.callouts?.length) {
      const cap = read(media(slug, "capture", `${beat.id}.json`));
      for (const [i, c] of beat.callouts.entries()) {
        const box = cap.marks[c.mark];
        if (!box) throw new Error(`${beat.id}: no mark "${c.mark}" in the capture (marks: ${Object.keys(cap.marks).join(", ")})`);
        const span = calloutSpan(c, vo.words, Math.max(seconds, cap.seconds));
        const frames = Math.round((span.end - span.start) * FPS);
        const out = media(slug, "graphics", `${beat.id}-callout-${i + 1}.mov`);
        // note: "" when absent, so the composition's sample default never shows.
        await render("Callout", { box, label: c.label, note: c.note ?? "", side: c.side ?? "bottom", dim: c.dim ?? true, frames }, out, true);
        entry.overlays.push({ file: out, start: span.start, end: span.end, label: c.label });
      }
    }
    manifest[beat.id] = entry;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`${beat.id}  ${entry.graphic ? "graphic, " : ""}${entry.overlays.length} callouts`);
  }
}

// Films each screen beat of a guide on the live site, in time with its voiceover.
//   node scripts/capture.mjs <slug> [beatId ...]
// Run voice.mjs first: every step's `at` is a word of the beat's narration, and the step lands on that word.
// Beats run in order in one signed-in headless browser, so a beat with "continue": true starts where the last one
// left the page. Each beat becomes <media>/<slug>/capture/<beat>.mp4 (2880x1620, the page drawn at 2x) plus a .json of
// the element boxes ("marks") the callouts and zooms point at, in 1920x1080 frame pixels.
//
// "prep": [steps] run first, unfilmed and untimed (waiting for drafts to finish, opening a menu to film it open).
// Step kinds (each may have "at": "<word>" | "<word>#2" | <seconds>):
//   {"click": sel} {"hover": sel} {"move": sel} {"type": text, "into": sel} {"press": "Enter"}
//   {"scroll": pixels, "over": sel?} {"wait": ms} {"waitFor": sel, "timeout": ms} {"waitGone": sel} {"goto": path}
//   {"mark": name, "sel": sel} {"still": name, "sel": sel?, "pad": px?}
// A sel is a Playwright selector (text=…, role=button[name="…"], css). The first match is used.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSite, SITE, VIEW } from "./browser.mjs";
import { media, script } from "./paths.mjs";

const LEAD = 0.5; // seconds of picture before the narration starts
const TAIL = 0.8; // and after it ends
const K = 1920 / VIEW.width; // CSS px -> 1080p frame px

// A drawn pointer that follows the real mouse, since screen capture does not include the system cursor.
const CURSOR = `
(() => {
  const install = () => {
    if (document.getElementById("__gcur")) return;
    const c = document.createElement("div");
    c.id = "__gcur";
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 14.8 L11.6 21.6 L14.4 20.4 L11.3 13.7 L17.6 13.4 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: 2147483647, pointerEvents: "none", transform: "translate(-4px,-2px)", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.35))" });
    const r = document.createElement("div");
    r.id = "__gring";
    Object.assign(r.style, { position: "fixed", width: "36px", height: "36px", marginLeft: "-18px", marginTop: "-18px", borderRadius: "50%", border: "3px solid #14a155", opacity: "0", zIndex: 2147483646, pointerEvents: "none" });
    document.documentElement.append(r, c);
    const p = JSON.parse(sessionStorage.getItem("__gpos") || '{"x":720,"y":420}');
    c.style.left = p.x + "px"; c.style.top = p.y + "px";
  };
  addEventListener("mousemove", (e) => {
    install();
    const c = document.getElementById("__gcur");
    c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px";
    sessionStorage.setItem("__gpos", JSON.stringify({ x: e.clientX, y: e.clientY }));
  }, true);
  addEventListener("mousedown", (e) => {
    const r = document.getElementById("__gring");
    if (!r) return;
    r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px";
    r.animate([{ transform: "scale(.4)", opacity: 1 }, { transform: "scale(1.4)", opacity: 0 }], { duration: 450, easing: "ease-out" });
  }, true);
  if (document.readyState !== "loading") install(); else addEventListener("DOMContentLoaded", install);
})();`;

const norm = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, "");

/** Seconds into the narration for a step's `at`: a number, a word, or the nth time a word is said ("add#2"). */
export function atSeconds(at, words) {
  if (at === undefined || at === null) return null;
  if (typeof at === "number") return at;
  const [w, nth] = String(at).split("#");
  const want = norm(w);
  let seen = 0;
  for (const word of words) {
    if (norm(word.text) === want && ++seen === Number(nth || 1)) return word.start;
  }
  throw new Error(`"${at}" is not said in this beat`);
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

async function glide(page, pos, x, y, ms = 550) {
  const n = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= n; i++) {
    const t = ease(i / n);
    await page.mouse.move(pos.x + (x - pos.x) * t, pos.y + (y - pos.y) * t);
    await page.waitForTimeout(ms / n);
  }
  pos.x = x;
  pos.y = y;
}

async function box(page, sel) {
  const loc = page.locator(sel).first();
  await loc.waitFor({ state: "visible", timeout: 15000 });
  await loc.scrollIntoViewIfNeeded();
  return loc.boundingBox();
}

async function filmBeat(page, cdp, slug, beat, pos, fresh, prevUrl) {
  const vo = JSON.parse(readFileSync(media(slug, "vo", `${beat.id}.json`), "utf8"));
  const shot = beat.shot;
  // A "continue" beat filmed on its own starts where the previous beat's last take ended.
  const start = shot.continue && fresh && prevUrl ? prevUrl : shot.url;
  if (start && (!shot.continue || fresh)) {
    await page.goto(SITE + start, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(shot.settle ?? 3000);
  }
  const frames = [];
  const dir = media(slug, "capture", `.frames-${beat.id}`, "x");
  rmSync(join(dir, ".."), { recursive: true, force: true });
  mkdirSync(join(dir, ".."), { recursive: true });
  const onFrame = async ({ data, metadata, sessionId }) => {
    frames.push({ t: metadata.timestamp, data });
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  };
  let t0 = Date.now() / 1000;
  const marks = {};
  const events = [];
  const until = async (sec) => {
    const wait = (t0 + LEAD + sec) * 1000 - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
  };
  const markBox = (name, b) => {
    if (b) marks[name] = { x: Math.round(b.x * K), y: Math.round(b.y * K), w: Math.round(b.width * K), h: Math.round(b.height * K), t: +(Date.now() / 1000 - t0).toFixed(2) };
  };

  const run = async (step, timed) => {
    const at = timed ? atSeconds(step.at, vo.words) : null;
    const sel = step.click ?? step.hover ?? step.move ?? step.into;
    if (sel) {
      // Arrive on the word: the glide starts a little before it.
      if (at !== null) await until(Math.max(0, at - 0.6));
      const b = await box(page, sel);
      markBox(step.name ?? sel, b);
      const x = b.x + Math.min(b.width / 2, step.dx ?? b.width / 2);
      const y = b.y + b.height / 2;
      await glide(page, pos, x, y, step.ms ?? 550);
      if (at !== null) await until(at);
      if (step.click || step.into) await page.mouse.click(x, y);
      if (step.type) await page.keyboard.type(step.type, { delay: step.delay ?? 45 });
    } else {
      if (at !== null) await until(at);
      if (step.press) await page.keyboard.press(step.press);
      if (step.scroll) {
        if (step.over) {
          const b = await page.locator(step.over).first().boundingBox();
          await glide(page, pos, b.x + b.width / 2, b.y + Math.min(b.height / 2, 300));
        }
        const n = Math.max(10, Math.round(Math.abs(step.scroll) / 25));
        for (let i = 0; i < n; i++) {
          await page.mouse.wheel(0, step.scroll / n);
          await page.waitForTimeout(16);
        }
      }
      if (step.wait) await page.waitForTimeout(step.wait);
      if (step.waitFor) await page.locator(step.waitFor).first().waitFor({ state: "visible", timeout: step.timeout ?? 60000 });
      if (step.waitGone) await page.locator(step.waitGone).first().waitFor({ state: "detached", timeout: step.timeout ?? 180000 });
      if (step.goto) {
        await page.goto(SITE + step.goto, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(step.settle ?? 2500);
      }
      if (step.mark) markBox(step.mark, await box(page, step.sel));
      if (step.still) {
        const path = media(slug, "stills", `${step.still}.png`);
        if (step.sel) {
          const b = await box(page, step.sel);
          const pad = step.pad ?? 16;
          const clip = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(VIEW.width, b.width + 2 * pad), height: Math.min(VIEW.height - Math.max(0, b.y - pad), b.height + 2 * pad) };
          await page.screenshot({ path, clip });
        } else {
          await page.screenshot({ path });
        }
        events.push({ still: step.still, t: +(Date.now() / 1000 - t0).toFixed(2) });
      }
    }
    events.push({ step: Object.keys(step)[0], at: step.at ?? null, t: +(Date.now() / 1000 - t0).toFixed(2) });
  };
  // Unfilmed setup: waits (an AI draft finishing), clicks to reach a state, anything the viewer doesn't need to see.
  for (const step of shot.prep ?? []) await run(step, false);
  for (const k of Object.keys(marks)) delete marks[k];
  events.length = 0;
  cdp.on("Page.screencastFrame", onFrame);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
  // Nudge a repaint so the first frame arrives now, not at the first change.
  await page.mouse.move(pos.x + 0.5, pos.y);
  t0 = Date.now() / 1000;
  for (const step of shot.steps ?? []) await run(step, true);
  const end = Math.max(vo.seconds + TAIL, shot.min ?? 0);
  await until(end);
  await cdp.send("Page.stopScreencast");
  cdp.off("Page.screencastFrame", onFrame);
  const tEnd = Date.now() / 1000;

  // Frames arrive only when the page changes; hold each one until the next, and the last until the end.
  const list = [];
  const kept = frames.filter((f) => f.t >= t0 - 0.2).sort((a, b) => a.t - b.t);
  if (!kept.length && frames.length) kept.push({ ...frames[frames.length - 1], t: t0 });
  kept.forEach((f, i) => {
    const file = join(dir, "..", `${String(i).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(f.data, "base64"));
    const next = i + 1 < kept.length ? kept[i + 1].t : tEnd;
    list.push(`file '${file}'`, `duration ${Math.max(0.001, next - Math.max(f.t, t0)).toFixed(4)}`);
  });
  list.push(list[list.length - 2]);
  const listFile = join(dir, "..", "list.txt");
  writeFileSync(listFile, list.join("\n"));
  const out = media(slug, "capture", `${beat.id}.mp4`);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", "fps=30,scale=2880:1620:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-tune", "animation", "-movflags", "+faststart", out]);
  rmSync(join(dir, ".."), { recursive: true, force: true });
  const seconds = +(tEnd - t0).toFixed(2);
  writeFileSync(media(slug, "capture", `${beat.id}.json`), JSON.stringify({ id: beat.id, lead: LEAD, seconds, frames: kept.length, marks, events, url: page.url().replace(SITE, "") }, null, 2));
  console.log(`${beat.id}  ${seconds.toFixed(1)} s  ${kept.length} frames  marks: ${Object.keys(marks).join(", ") || "-"}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [slug, ...only] = process.argv.slice(2);
  const guide = script(slug);
  const { browser, context, page } = await openSite();
  await context.addInitScript(CURSOR);
  const cdp = await context.newCDPSession(page);
  const pos = { x: 720, y: 420 };
  let failed = false;
  let prevFilmed = null;
  for (const [i, beat] of guide.beats.entries()) {
    if (!beat.shot) continue;
    // Filming one "continue" beat alone: give it a "url" too, so it has a page to start from.
    if (only.length && !only.includes(beat.id)) continue;
    if (!existsSync(media(slug, "vo", `${beat.id}.json`))) {
      console.log(`${beat.id}  no voiceover yet; run voice.mjs first`);
      continue;
    }
    try {
      const prevShot = guide.beats.slice(0, i).reverse().find((b) => b.shot);
      const prevJson = prevShot && media(slug, "capture", `${prevShot.id}.json`);
      const prevUrl = prevJson && existsSync(prevJson) ? JSON.parse(readFileSync(prevJson, "utf8")).url : null;
      await filmBeat(page, cdp, slug, beat, pos, !prevShot || prevFilmed !== prevShot.id, prevUrl);
      prevFilmed = beat.id;
    } catch (e) {
      failed = true;
      console.log(`${beat.id}  FAILED: ${e.message.split("\n")[0]}`);
      await page.screenshot({ path: media(slug, "capture", `${beat.id}.error.png`) }).catch(() => {});
      await cdp.send("Page.stopScreencast").catch(() => {});
    }
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
}

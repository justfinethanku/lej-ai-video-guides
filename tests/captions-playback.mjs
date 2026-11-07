// Opt-in real decoding/playback check. Run: node tests/captions-playback.mjs <screenshot-directory>
// Uses the kit's configured Playwright Chromium via openSite(); no app service or paid generation.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { pageElement, guide } from "./site-fixture.mjs";
import { captionPlan } from "./caption-fixture.mjs";
import { openSite, chromePath } from "../scripts/browser.mjs";
import { CONFIG, MEDIA, STUDIO } from "../scripts/paths.mjs";

assert.equal(CONFIG.publish?.type, "folder", "Playback fixture requires folder publication");
assert.equal(CONFIG.session?.from, "none", "Playback fixture requires no signed-in session");
assert.ok(!CONFIG.serveDir, "Playback fixture requires serveDir to be omitted");
const screens = resolve(process.argv[2] ?? "out/caption-screens");
await mkdir(screens, { recursive: true });
async function playback() {
  const renders = join(MEDIA, "caption-demo/renders");
  await mkdir(renders, { recursive: true });
  const video = join(renders, "caption-demo-guide-v1.mp4");
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x334155:s=960x540:r=10:d=12",
    "-f", "lavfi", "-i", "sine=frequency=220:duration=12", "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-movflags", "+faststart", "-shortest", video]);
  const plan = { ...captionPlan(), schema_version: 3 };
  const bytes = await readFile(video);
  plan.render = { status: "complete", file: "caption-demo-guide-v1.mp4", bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex") };
  await writeFile(join(renders, "caption-demo-guide-v1.plan.json"), JSON.stringify(plan));
  await writeFile(join(STUDIO, "content/caption-demo.json"), JSON.stringify({ title: "Caption playback", position: 1, summary: "Synthetic media", asOf: "2026-11-07" }));
  await writeFile(join(STUDIO, "content/caption-demo.md"), "Synthetic written guide.");
  try {
    execFileSync(process.execPath, [join(STUDIO, "scripts/publish.mjs"), "caption-demo", "1"], { stdio: "inherit" });
  } finally {
    await unlink(join(STUDIO, "content/caption-demo.json"));
    await unlink(join(STUDIO, "content/caption-demo.md"));
  }
  const output = join(MEDIA, "caption-demo/site/v1");
  const row = JSON.parse(await readFile(join(output, "guide.json"), "utf8"));
  const origin = "http://caption-playback.test";
  const html = renderToStaticMarkup(await pageElement([{ ...guide, ...row,
    video: `${origin}/${row.video_path}`, captions: `${origin}/${row.captions_path}`, poster: null, assets: {} }]));
  const { browser, context, page } = await openSite();
  try {
    await context.route(`${origin}/**`, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Caption playback</title><style>body{font:20px sans-serif;margin:32px}.gd-video{width:960px}.gd-sr-only,.gd-intro,.gd-toc,.gd-written{display:none}</style></head><body>${html}</body></html>` });
      if (path === `/${row.video_path}`) {
        const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Number(range[2]) : bytes.length - 1;
        return route.fulfill({ status: range ? 206 : 200, contentType: "video/mp4", body: bytes.subarray(start, end + 1),
          headers: { "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1),
            ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}) } });
      }
      if (path === `/${row.captions_path}`) return route.fulfill({ contentType: "text/vtt", body: await readFile(join(output, "caption-demo-guide-v1.vtt")) });
      return route.fulfill({ status: 404, body: "Not found" });
    });
    await page.goto(origin);
    await page.bringToFront();
    await page.waitForFunction(() => document.querySelector("video").readyState >= 2 && document.querySelector("track").readyState === 2, undefined, { polling: 100 });
    const exposed = await page.locator("video").evaluate(v => {
      const track = v.textTracks[0];
      return { kind: track.kind, language: track.language, label: track.label, mode: track.mode, cues: [...track.cues].map(c => ({ start: c.startTime, end: c.endTime, text: c.text })) };
    });
    assert.equal(exposed.kind, "captions"); assert.equal(exposed.language, "en"); assert.equal(exposed.label, "English");
    assert.equal(exposed.mode, "showing");
    assert.deepEqual(exposed.cues.map(c => c.start), [1.5, 7]);
    await page.locator("video").evaluate(v => { v.textTracks[0].mode = "disabled"; });
    assert.equal(await page.locator("video").evaluate(v => v.textTracks[0].mode), "disabled");
    await page.locator("video").evaluate(v => { v.textTracks[0].mode = "showing"; v.currentTime = 1.25; });
    await page.waitForFunction(() => document.querySelector("video").textTracks[0].activeCues?.length === 0, undefined, { polling: 100 });
    await page.locator("video").evaluate(v => { v.currentTime = 1.75; });
    await page.waitForFunction(() => document.querySelector("video").textTracks[0].activeCues?.[0]?.text === "Open the guide.", undefined, { polling: 100 });
    await page.locator("video").evaluate(v => { v.currentTime = 6.75; });
    await page.waitForFunction(() => document.querySelector("video").textTracks[0].activeCues?.length === 0, undefined, { polling: 100 });
    await page.locator("video").evaluate(async v => { v.muted = true; await v.play(); });
    await page.waitForFunction(() => document.querySelector("video").currentTime > 7.25 && document.querySelector("video").textTracks[0].activeCues?.[0]?.text === "Choose English captions.", undefined, { polling: 100 });
    await page.locator("video").evaluate(v => v.pause());
    const screenshot = join(screens, "english-captions.png");
    await page.screenshot({ path: screenshot });
    console.log(JSON.stringify({ chromium: chromePath(), exposed, playbackTime: await page.locator("video").evaluate(v => v.currentTime), screenshot }, null, 2));
  } catch (error) {
    console.error(await page.locator("video").evaluate(v => ({ time: v.currentTime, seeking: v.seeking,
      readyState: v.readyState, error: v.error?.message, mode: v.textTracks[0]?.mode,
      active: [...(v.textTracks[0]?.activeCues ?? [])].map(c => c.text),
      buffered: Array.from({ length: v.buffered.length }, (_, i) => [v.buffered.start(i), v.buffered.end(i)]) })));
    throw error;
  } finally {
    await browser.close();
  }
}

try {
  await playback();
} finally {
  await rm(join(MEDIA, "caption-demo"), { recursive: true, force: true });
}

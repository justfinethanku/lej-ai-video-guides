import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { captionCues, webVtt } from "../scripts/captions.mjs";
import { captionPlan } from "./caption-fixture.mjs";

test("two-beat captions include final-cut lead and beat offsets, with known music only", () => {
  const plan = captionPlan();
  assert.deepEqual(captionCues(plan), [
    { start: 0, end: 1.5, text: "[Music]" },
    { start: 1.5, end: 3.5, text: "Open the guide." },
    { start: 7, end: 10, text: "Choose English captions." },
    { start: 10, end: 12, text: "[Music]" },
  ]);
  assert.match(webVtt(plan), /^WEBVTT\n\n00:00:00.000 --> 00:00:01.500/);
  plan.music = false;
  assert.equal(captionCues(plan).length, 2, "no invented non-speech cues");
});

test("captions wrap at 42 characters, split long phrases and escape WebVTT markup", () => {
  const plan = captionPlan();
  const text = "Choose the English captions to follow every step and keep reading along <safely> & clearly.";
  plan.seconds = 30; plan.music = false; plan.beats = [plan.beats[0]];
  plan.beats[0].length = 30;
  plan.beats[0].narration = { say: text, seconds: 25,
    words: text.split(" ").map((text, i) => ({ text, start: i * 1.2, end: i * 1.2 + 0.8 })) };
  const cues = captionCues(plan);
  assert.ok(cues.length > 2);
  assert.equal(cues.map(c => c.text).join(" "), text);
  assert.ok(cues.every(c => c.text.length <= 42 && c.end - c.start <= 7 && c.end - c.start >= 1));
  assert.match(webVtt(plan), /&lt;safely&gt; &amp; clearly\./);
});

test("missing, nonnumeric, reversed, overlapping and out-of-cut timing fail clearly", () => {
  const corruptions = [
    p => delete p.beats[0].narration, p => delete p.beats[0].vo_start,
    p => { p.beats[0].vo_start = "0.5"; }, p => { p.seconds = NaN; },
    p => { p.beats[0].narration.words = []; }, p => delete p.beats[0].narration.words[0].end,
    p => { p.beats[0].narration.words[0] = null; }, p => { p.beats = {}; },
    p => { p.beats[0].narration.words[0].start = -1; },
    p => { p.beats[0].narration.words[0].end = 0.5; },
    p => { p.beats[0].narration.words[1].start = 1.2; },
    p => { p.beats[0].narration.words[2].end = 10; },
    p => { p.beats[0].length = 2; },
    p => { p.beats[0].narration.seconds = Infinity; },
  ];
  for (const corrupt of corruptions) {
    const plan = captionPlan(); corrupt(plan);
    assert.throws(() => webVtt(plan), /Caption timing:.*Rebuild the cut.*new version/);
  }
});

async function publisher(t, supabase = false) {
  const root = await mkdtemp(join(tmpdir(), "guides-captions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ["scripts", "content", "bin", "media/demo/renders"]) await mkdir(join(root, dir), { recursive: true });
  for (const file of ["paths.mjs", "publish.mjs", "publish-plan.mjs", "captions.mjs", "resumable-upload.mjs"]) {
    await copyFile(new URL(`../scripts/${file}`, import.meta.url), join(root, "scripts", file));
  }
  await writeFile(join(root, "content/demo.json"), JSON.stringify({ title: "Demo", position: 1, summary: "Demo", asOf: "2026-11-07" }));
  await writeFile(join(root, "content/demo.md"), "Synthetic written guide");
  // Fake credentials and intercepted fetch: this fixture cannot reach a real Supabase service.
  await writeFile(join(root, "supabase-fixture.txt"), "SUPABASE_URL=https://storage.invalid\nSUPABASE_SERVICE_ROLE_KEY=synthetic\n");
  await writeFile(join(root, "guides.config.json"), JSON.stringify({ media: join(root, "media"),
    publish: supabase ? { type: "supabase", envFile: "supabase-fixture.txt" } : { type: "folder" } }));
  await writeFile(join(root, "bin/ffmpeg"), `#!${process.execPath}\nrequire('fs').writeFileSync(process.argv.at(-1), 'synthetic poster');\n`, { mode: 0o755 });
  await writeFile(join(root, "fetch.mjs"), `import fs from 'node:fs';
globalThis.fetch = async (url, options) => {
  if (!url.startsWith('https://storage.invalid/')) throw new Error('Unexpected network');
  fs.appendFileSync(${JSON.stringify(join(root, "uploads.jsonl"))}, JSON.stringify({url, headers: options.headers, body: options.body.toString()})+'\\n');
  return new Response('', {status: 200});
};`);
  const save = async plan => {
    await writeFile(join(root, `media/demo/renders/demo-guide-v${plan.version}.plan.json`), JSON.stringify(plan));
    await writeFile(join(root, `media/demo/renders/demo-guide-v${plan.version}.mp4`), "synthetic render");
  };
  const run = version => spawnSync(process.execPath, ["--import", join(root, "fetch.mjs"), join(root, "scripts/publish.mjs"), "demo", String(version)],
    { env: { ...process.env, GUIDES_MEDIA: join(root, "media"), PATH: `${join(root, "bin")}:${process.env.PATH}` }, encoding: "utf8" });
  return { root, save, run };
}

for (const supabase of [false, true]) test(`${supabase ? "Supabase" : "folder"} publication binds captions to the video version`, async t => {
  const f = await publisher(t, supabase);
  const v1 = captionPlan(); await f.save(v1);
  assert.equal(f.run(1).status, 0);
  const original = await readFile(join(f.root, "media/demo/publish/v1/demo-guide-v1.vtt"), "utf8");
  const v2 = captionPlan(2); v2.beats[1].vo_start = 7; await f.save(v2);
  assert.equal(f.run(2).status, 0);
  assert.equal(await readFile(join(f.root, "media/demo/publish/v1/demo-guide-v1.vtt"), "utf8"), original);
  if (!supabase) {
    assert.equal(await readFile(join(f.root, "media/demo/site/v1/demo-guide-v1.vtt"), "utf8"), original);
    const row = JSON.parse(await readFile(join(f.root, "media/demo/site/v2/guide.json"), "utf8"));
    assert.equal(row.captions_path, "demo/v2/demo-guide-v2.vtt");
  } else {
    const requests = (await readFile(join(f.root, "uploads.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    const captions = requests.filter(r => r.url.endsWith(".vtt"));
    assert.equal(captions.length, 2);
    assert.ok(captions[0].url.endsWith("demo/v1/demo-guide-v1.vtt"));
    assert.ok(captions[1].url.endsWith("demo/v2/demo-guide-v2.vtt"));
    assert.equal(captions[0].body, original);
    assert.equal(captions[1].headers["Content-Type"], "text/vtt; charset=utf-8");
    const rows = requests.filter(r => r.url.includes("/rest/v1/")).map(r => JSON.parse(r.body));
    assert.equal(rows[0].captions_path, "demo/v1/demo-guide-v1.vtt");
    assert.equal(rows[1].captions_path, "demo/v2/demo-guide-v2.vtt");
  }
});

test("publisher rejects missing timing before any upload", async t => {
  const f = await publisher(t, true);
  const plan = captionPlan(); delete plan.beats[1].vo_start; await f.save(plan);
  const result = f.run(1);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Caption timing: beat b:.*vo_start/);
  await assert.rejects(readFile(join(f.root, "uploads.jsonl")), { code: "ENOENT" });
});

test("site loader requests and signs captions with the matching version's media", async () => {
  const source = await readFile(new URL("../site-example/guides.ts", import.meta.url), "utf8");
  const module = { exports: {} };
  const row = { slug: "demo", video_path: "demo/v2/demo-guide-v2.mp4", captions_path: "demo/v2/demo-guide-v2.vtt", poster_path: null, body_md: "" };
  const calls = [];
  const compiled = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" }).code;
  new Function("require", "module", "exports", "fetch", "process", compiled)(id => {
    if (id === "./supabase-rest") return { rest: async path => { assert.match(path, /captions_path/); return [row]; } };
    return createRequire(import.meta.url)(id);
  }, module, module.exports, async (url, options) => {
    const request = JSON.parse(options.body); calls.push(request.paths);
    return { ok: true, json: async () => request.paths.map(path => ({ path, signedURL: `/object/sign/guides/${path}?token=synthetic` })) };
  }, { env: { SUPABASE_URL: "https://storage.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic" } });
  const [guide] = await module.exports.loadGuides();
  assert.deepEqual(calls, [[row.video_path, row.captions_path]]);
  assert.equal(guide.captions, "https://storage.invalid/storage/v1/object/sign/guides/demo/v2/demo-guide-v2.vtt?token=synthetic");
  assert.equal(guide.assets[row.captions_path], guide.captions);
});

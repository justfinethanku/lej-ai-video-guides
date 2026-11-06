import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Run the actual voice CLI in a disposable studio. fetch is replaced before the CLI loads;
// no request can reach ElevenLabs. Media tools record arguments and write synthetic bytes.
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "guides-voice-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const sub of ["scripts", "content", "bin"]) await mkdir(join(dir, sub));
  for (const name of ["voice.mjs", "paths.mjs"]) {
    await copyFile(new URL(`../scripts/${name}`, import.meta.url), join(dir, "scripts", name));
  }
  const config = { media: join(dir, "media"), voice: { id: "fixture-voice", model: "fixture-model", keyEnv: "GUIDES_TEST_KEY", lufs: -16 } };
  const guide = { beats: [{ id: "a", say: "Hello world." }, { id: "silent" }, { id: "b", say: "Next line." }, { id: "c", say: "Last line." }] };
  const save = async () => {
    await writeFile(join(dir, "guides.config.json"), JSON.stringify(config));
    await writeFile(join(dir, "content/demo.json"), JSON.stringify(guide));
  };
  await save();
  const log = join(dir, "calls.jsonl");
  const preload = join(dir, "provider.mjs");
  await writeFile(preload, `import fs from 'node:fs';
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith('https://api.elevenlabs.io/v1/text-to-speech/fixture-voice/with-timestamps')) throw Error('Unexpected URL');
  const body = JSON.parse(options.body);
  fs.appendFileSync(process.env.VOICE_TEST_LOG, JSON.stringify({ kind: 'fetch', url, body })+'\\n');
  if (process.env.VOICE_TEST_FAIL === 'provider') return new Response('synthetic failure', { status: 503 });
  if (process.env.VOICE_TEST_FAIL === 'hints' && (body.previous_text || body.next_text)) return new Response('hints refused', { status: 400 });
  const characters = [...body.text];
  return Response.json({ audio_base64: Buffer.from('synthetic PCM: '+body.text).toString('base64'), alignment: {
    characters, character_start_times_seconds: characters.map((_, i) => i/10), character_end_times_seconds: characters.map((_, i) => (i+1)/10)
  }});
};
`);
  await writeFile(join(dir, "bin/package.json"), '{"type":"module"}');
  const tool = `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
const kind = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.VOICE_TEST_LOG, JSON.stringify({ kind, args })+'\\n');
if (kind === 'ffprobe') { console.log(process.env.VOICE_TEST_FAIL === 'duration' ? 'N/A' : '2.5'); process.exit(0); }
if (args.includes('ebur128=framelog=quiet')) { console.error(' I: -20.0 LUFS'); process.exit(process.env.VOICE_TEST_FAIL === 'measure' ? 1 : 0); }
fs.writeFileSync(args.at(-1), 'synthetic WAV: '+args.join(' '));
if (process.env.VOICE_TEST_FAIL === 'convert' && args.includes('s16le')) process.exit(1);
`;
  for (const name of ["ffmpeg", "ffprobe"]) await writeFile(join(dir, "bin", name), tool, { mode: 0o755 });
  const run = (only = [], fail = "") => spawnSync(process.execPath, ["--import", preload, join(dir, "scripts/voice.mjs"), "demo", ...only], {
    env: { ...process.env, GUIDES_MEDIA: config.media, GUIDES_TEST_KEY: "synthetic-test-value", PATH: `${dir}/bin:${process.env.PATH}`, VOICE_TEST_LOG: log, VOICE_TEST_FAIL: fail },
    encoding: "utf8", timeout: 15000,
  });
  const ok = (only = [], fail = "") => { const r = run(only, fail); assert.equal(r.status, 0, r.stderr); return r; };
  const calls = async () => (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
  const clear = () => writeFile(log, "");
  const file = (beat, extension) => join(config.media, "demo/vo", `${beat}.${extension}`);
  const meta = async (beat) => JSON.parse(await readFile(file(beat, "json"), "utf8"));
  return { dir, config, guide, save, run, ok, calls, clear, file, meta };
}

test("voice CLI aligns words, levels audio, skips silent beats and reuses complete takes", async (t) => {
  const f = await fixture(t);
  f.ok();
  const calls = await f.calls();
  const requests = calls.filter((c) => c.kind === "fetch");
  assert.deepEqual(requests.map((r) => r.body.text), ["Hello world.", "Next line.", "Last line."]);
  assert.equal(requests[0].body.next_text, "Next line.");
  assert.equal(requests[0].body.previous_text, undefined);
  assert.equal(requests[1].body.previous_text, "Hello world.");
  assert.equal(requests[1].body.next_text, "Last line.");
  const meta = await f.meta("a");
  assert.equal(meta.seconds, 2.5);
  assert.deepEqual(meta.words, [{ text: "Hello", start: 0, end: 0.5 }, { text: "world.", start: 0.6, end: 1.2 }]);
  assert.ok(calls.some((c) => c.args?.includes("volume=4.00dB,alimiter=limit=0.89:level=false")));
  const wav = await readFile(f.file("a", "wav"));
  await f.clear();
  f.ok();
  assert.deepEqual(await f.calls(), []);
  assert.deepEqual(await readFile(f.file("a", "wav")), wav);
});

test("missing audio is regenerated even when its metadata hash matches", async (t) => {
  const f = await fixture(t);
  f.ok(["b"]);
  await rm(f.file("b", "wav"));
  await f.clear();
  f.ok(["b"]);
  assert.deepEqual((await f.calls()).filter((c) => c.kind === "fetch").map((c) => c.body.text), ["Next line."]);
  assert.ok((await readFile(f.file("b", "wav"))).length > 0);
});

test("changing neighboring spoken text invalidates a selected take's context", async (t) => {
  const f = await fixture(t);
  f.ok(["b"]);
  const before = (await f.meta("b")).hash;
  f.guide.beats[0].say = "Changed opening.";
  await f.save();
  await f.clear();
  f.ok(["b"]);
  const requests = (await f.calls()).filter((c) => c.kind === "fetch");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.previous_text, "Changed opening.");
  assert.notEqual((await f.meta("b")).hash, before);
});

test("empty audio is regenerated rather than treated as a cached take", async (t) => {
  const f = await fixture(t);
  f.ok(["b"]);
  await writeFile(f.file("b", "wav"), "");
  await f.clear();
  f.ok(["b"]);
  assert.equal((await f.calls()).filter((c) => c.kind === "fetch").length, 1);
  assert.ok((await readFile(f.file("b", "wav"))).length > 0);
});

test("changing target loudness invalidates the normalized take", async (t) => {
  const f = await fixture(t);
  f.ok(["b"]);
  f.config.voice.lufs = -18;
  await f.save();
  await f.clear();
  f.ok(["b"]);
  assert.ok((await f.calls()).some((c) => c.args?.includes("volume=2.00dB,alimiter=limit=0.89:level=false")));
});

test("hint rejection retries the selected line without hints and caches the result", async (t) => {
  const f = await fixture(t);
  f.ok(["b"], "hints");
  const requests = (await f.calls()).filter((c) => c.kind === "fetch");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.text, "Next line.");
  assert.equal(requests[1].body.previous_text, undefined);
  assert.equal(requests[1].body.next_text, undefined);
  await f.clear();
  f.ok(["b"]);
  assert.deepEqual(await f.calls(), []);
});

for (const failure of ["provider", "convert", "measure", "duration"]) {
  test(`failed ${failure} preserves the last successful take and can be retried`, async (t) => {
    const f = await fixture(t);
    f.ok(["b"]);
    const wav = await readFile(f.file("b", "wav"));
    const meta = await readFile(f.file("b", "json"));
    f.guide.beats[2].say = "Replacement line.";
    await f.save();
    assert.notEqual(f.run(["b"], failure).status, 0);
    assert.deepEqual(await readFile(f.file("b", "wav")), wav);
    assert.deepEqual(await readFile(f.file("b", "json")), meta);
    assert.deepEqual((await readdir(join(f.config.media, "demo/vo"))).sort(), ["b.json", "b.wav"]);
    f.ok(["b"]);
    assert.equal((await f.meta("b")).say, "Replacement line.");
    assert.notEqual((await f.meta("b")).hash, JSON.parse(meta).hash);
  });
}

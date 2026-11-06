import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { stillTime } from "../scripts/publish-plan.mjs";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "guides-plan-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const studio = join(dir, "studio");
  const media = join(dir, "media");
  const output = execFileSync("python3", [fileURLToPath(new URL("./plan-fixture.py", import.meta.url)), studio, media], { encoding: "utf8" });
  return { studio, media, ...JSON.parse(output) };
}

const near = (got, expected) => assert.ok(Math.abs(got - expected) < 1e-9, `${got} != ${expected}`);

test("offline planner preserves clip layout, cue-driven titles/zooms and publication metadata", async (t) => {
  const { plan, saved } = await fixture(t);
  assert.deepEqual(plan.beats.map((b) => b.id), ["g1", "s1", "m1"]);
  near(plan.beats[1].start, 9.3);
  near(plan.beats[1].length, 281 / 30); // floor screen capture to available frames
  near(plan.beats[2].start, 9.3 + 281 / 30);
  near(plan.beats[2].from, 2);
  near(plan.seconds, 9.3 * 2 + 281 / 30);
  near(plan.beats[1].vo_start, 9.8);
  assert.deepEqual(plan.beats[1].zooms[0], { x: 700 / 1920, y: 1 - 340 / 1080, scale: 1.5, start: 1.5, end: 4.5 });
  near(plan.overlays[0].start, 10.65);
  near(plan.overlays[0].length, 3.1);
  assert.equal(plan.markers[0].name, "First");
  near(plan.titles[0].start, 0.3);
  near(plan.titles[1].start, 11.6);
  assert.equal(saved.schema_version, 2);
  assert.equal(saved.version, 1);
  assert.equal(saved.timeline, "Demo guide v1");
  assert.deepEqual(saved.beats[1].publish, { graphic: false, overlays: [{ start: 1.35, end: 4.45 }] });
  near(stillTime(saved.beats[0]), 8.6);
  near(stillTime(saved.beats[1]), 11.85);
  near(stillTime(saved.beats[2]), saved.beats[2].start + 5.58);
});

// Exercise the real publishing CLI in folder mode. ffmpeg is a recording stand-in here so the test checks
// exact extraction requests and published artifacts without rendering, a browser, credentials or a remote write.
async function publisher(t) {
  const f = await fixture(t);
  await mkdir(join(f.studio, "scripts"));
  for (const file of ["paths.mjs", "publish.mjs", "publish-plan.mjs"]) {
    await copyFile(new URL(`../scripts/${file}`, import.meta.url), join(f.studio, "scripts", file));
  }
  await writeFile(join(f.studio, "guides.config.json"), JSON.stringify({ media: f.media, publish: { type: "folder" } }));
  await writeFile(join(f.studio, "content/demo.md"), "![Flow](shot:g1)\n![Button](shot:s1)\n![Clip](shot:m1)\n");
  await writeFile(join(f.media, "demo/renders/demo-guide-v1.mp4"), "synthetic render");
  const bin = join(f.studio, "bin");
  await mkdir(bin);
  const log = join(f.studio, "ffmpeg.jsonl");
  await writeFile(join(bin, "ffmpeg"), `#!${process.execPath}\nimport fs from 'node:fs';\nconst args = process.argv.slice(2);\nfs.appendFileSync(process.env.FFMPEG_LOG, JSON.stringify(args)+'\\n');\nfs.writeFileSync(args.at(-1), 'synthetic image');\n`, { mode: 0o755 });
  // The stand-in is ESM even though its extension is empty.
  await writeFile(join(bin, "package.json"), '{"type":"module"}');
  const run = () => {
    const result = spawnSync(process.execPath, [join(f.studio, "scripts/publish.mjs"), "demo", "1"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FFMPEG_LOG: log }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result;
  };
  const times = async () => (await readFile(log, "utf8")).trim().split("\n").map((line) => {
    const args = JSON.parse(line);
    return Number(args[args.indexOf("-ss") + 1]);
  });
  return { ...f, log, run, times };
}

test("publishing v1 ignores newer graphics and works after the working manifest is removed", async (t) => {
  const f = await publisher(t);
  const manifestPath = join(f.media, "demo/graphics/manifest.json");
  await writeFile(manifestPath, JSON.stringify({ g1: { overlays: [{ start: 1, end: 3 }] } }));
  assert.equal(f.run().stderr, "");
  const expected = [8.6, 11.85, 24.25, 3];
  assert.deepEqual(await f.times(), expected);
  await rm(f.log);
  await rm(manifestPath);
  assert.equal(f.run().stderr, "");
  assert.deepEqual(await f.times(), expected);
  const output = join(f.media, "demo/site/v1");
  const row = JSON.parse(await readFile(join(output, "guide.json"), "utf8"));
  assert.equal(row.version, 1);
  assert.equal(row.video_path, "demo/v1/demo-guide-v1.mp4");
  assert.match(row.body_md, /asset:demo\/v1\/g1-shot.jpg/);
  assert.doesNotMatch(row.body_md, /shot:/);
  assert.equal(await readFile(join(output, "demo-guide-v1.mp4"), "utf8"), "synthetic render");
});

test("legacy render plans retain manifest-based selection with an explicit warning", async (t) => {
  const f = await publisher(t);
  const legacy = { ...f.saved, beats: f.saved.beats.map(({ publish, ...beat }) => beat) };
  delete legacy.schema_version;
  await writeFile(join(f.media, "demo/renders/demo-guide-v1.plan.json"), JSON.stringify(legacy));
  const result = f.run();
  assert.match(result.stderr, /Legacy edit plan/);
  assert.deepEqual(await f.times(), [8.6, 11.85, 24.25, 3]);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "guides-browser-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "scripts"));
  for (const file of ["browser.mjs", "doctor.mjs", "paths.mjs", "static-files.mjs"]) {
    await copyFile(new URL(`../scripts/${file}`, import.meta.url), join(dir, "scripts", file));
  }
  await symlink(fileURLToPath(new URL("../node_modules", import.meta.url)), join(dir, "node_modules"), "junction");
  await writeFile(join(dir, "guides.config.json"), JSON.stringify({
    product: "Test", site: "http://localhost", media: dir, voice: { keyEnv: "GUIDES_TEST_UNUSED_KEY" },
  }));
  const env = { ...process.env, HOME: dir, PLAYWRIGHT_BROWSERS_PATH: join(dir, "cache"), GUIDES_TEST_UNUSED_KEY: "" };
  const run = (args) => spawnSync(process.execPath, args, { cwd: dir, env, encoding: "utf8", timeout: 20000 });
  const expected = run(["--input-type=module", "-e", 'import { chromium } from "playwright-core"; console.log(chromium.executablePath())']);
  assert.equal(expected.status, 0, expected.stderr);
  const path = expected.stdout.trim();
  await mkdir(dirname(path), { recursive: true });
  // The old doctor passed on a directory name in the default cache, even with no binary.
  await mkdir(join(dir, ".cache", "ms-playwright", "chromium-99999"), { recursive: true });
  return { dir, run, path };
}

test("discovery selects installed Playwright's executable in an isolated cache", async (t) => {
  const { dir, run, path } = await fixture(t);
  // Decoy builds must not win by revision number or by a previously recognized layout.
  for (const revision of [1, 99999]) {
    const old = join(dir, "cache", `chromium-${revision}`, "chrome-linux");
    await mkdir(old, { recursive: true });
    await writeFile(join(old, "chrome"), "decoy");
  }
  await writeFile(path, "current executable marker");
  const result = run(["--input-type=module", "-e", 'import { chromePath } from "./scripts/browser.mjs"; console.log(chromePath())']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), path);
});

test("doctor rejects a cache directory without the expected executable", async (t) => {
  const { run, path } = await fixture(t);
  const result = run(["scripts/doctor.mjs"]);
  assert.equal(result.status, 1, result.stderr);
  assert.ok(result.stdout.includes(`✗ Chromium for filming  Chromium executable missing: ${path}`), result.stdout);
  assert.match(result.stdout, /pnpm exec playwright-core install chromium/);
  assert.doesNotMatch(result.stdout, /✓ Chromium for filming/);
});

test("doctor rejects an existing executable that cannot launch", async (t) => {
  const { run, path } = await fixture(t);
  await writeFile(path, "not a browser");
  const result = run(["scripts/doctor.mjs"]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /✗ Chromium for filming  browserType.launch:/);
  assert.doesNotMatch(result.stdout, /Chromium executable missing:|✓ Chromium for filming/);
});

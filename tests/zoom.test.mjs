import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("zooms are planned strictly, built unlocked, and verified in the rendered video before publication", () => {
  const result = spawnSync("python3", ["-B", fileURLToPath(new URL("./zoom-fixture.py", import.meta.url))], {
    encoding: "utf8", timeout: 180_000,
    // The C locale: a build started from cron or a bare shell has no UTF-8 default, and must still write its log.
    env: { ...process.env, LC_ALL: "C", LANG: "C", PYTHONUTF8: "0", PYTHONCOERCECLOCALE: "0", GUIDES_TEST_ASCII_LOCALE: "1" },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

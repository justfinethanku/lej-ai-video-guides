import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("actual Resolve build CLI quarantines failures and commits only completed render artifacts", () => {
  const result = spawnSync("python3", ["-B", fileURLToPath(new URL("./resolve-render-fixture.py", import.meta.url))], {
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("archive recovery preserves render ownership and reports rejected exports", () => {
  const result = spawnSync("python3", ["-B", fileURLToPath(new URL("./export-recovery-fixture.py", import.meta.url))], {
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

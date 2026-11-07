import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("offline callout allocation and Resolve CLI preserve every simultaneous overlay", () => {
  const result = spawnSync("python3", ["-B", fileURLToPath(new URL("./overlay-layout-fixture.py", import.meta.url))], {
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

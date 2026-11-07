import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("Resolve timeline assembly rejects missing media and preserves interrupted versions", () => {
  const result = spawnSync("python3", ["-B", fileURLToPath(new URL("./timeline-assembly-fixture.py", import.meta.url))], {
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

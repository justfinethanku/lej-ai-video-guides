import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// Resolve the actual copies consumed by the rendering toolchain, rather than an unrelated direct dependency.
const require = createRequire(import.meta.url);
const bundler = createRequire(require.resolve("@remotion/bundler"));
const postcss = createRequire(bundler.resolve("postcss"));
const studio = createRequire(bundler.resolve("@remotion/studio"));
const webpack = createRequire(bundler.resolve("webpack"));
const schema = createRequire(webpack.resolve("schema-utils"));
const ajv = createRequire(schema.resolve("ajv"));

test("CSS source maps reject excessive indexed offsets before amplification", () => {
  const { SourceMapConsumer } = postcss("source-map-js");
  const map = { version: 3, sources: ["input.css"], names: [], mappings: "AAAA" };
  assert.equal(new SourceMapConsumer(map).sources[0], "input.css");
  assert.throws(() => new SourceMapConsumer({
    version: 3,
    sections: [{ offset: { line: 100000001, column: 0 }, map }],
  }));
});

test("bounded Studio validation rejects oversized arrays without collecting every issue", () => {
  const { z } = studio("zod");
  const bounded = z.array(z.string()).max(2);
  assert.equal(bounded.safeParse(["ok"]).success, true);
  const result = bounded.safeParse(Array(1000).fill(0));
  assert.equal(result.success, false);
  assert.equal(result.error.issues.length, 1);
  assert.equal(result.error.issues[0].code, "too_big");
});

test("webpack URI resolution does not activate a percent-encoded scheme", () => {
  const uri = ajv("fast-uri");
  assert.equal(uri.resolve("https://example.test/a/", "b"), "https://example.test/a/b");
  // The patched parser may reject the input or preserve the inert encoding.
  let normalized;
  try { normalized = uri.normalize("%6Aavascript:alert(1)"); } catch { return; }
  assert.doesNotMatch(normalized, /^javascript:/i);
});

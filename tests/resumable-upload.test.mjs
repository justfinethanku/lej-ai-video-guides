import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { uploadResumable } from "../scripts/resumable-upload.mjs";

const CHUNK = 6 * 1024 * 1024;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t, size = CHUNK * 2 + 17) {
  const dir = await mkdtemp(join(tmpdir(), "guides-tus-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "video.mp4");
  const bytes = Buffer.allocUnsafe(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + Math.floor(i / 65536)) % 251;
  await writeFile(file, bytes);
  const calls = [], delays = [], received = [];
  let offset = 0;
  const fetchImpl = async (url, request) => {
    calls.push({ url, ...request, body: undefined });
    assert.equal(request.headers.Authorization, "Bearer synthetic-fixture");
    if (request.method === "DELETE") return new Response(null, { status: 200 });
    assert.equal(request.headers["Tus-Resumable"], "1.0.0");
    if (request.method === "POST") {
      assert.equal(request.headers["Upload-Length"], String(bytes.length));
      assert.equal(request.headers["x-upsert"], "true");
      const metadata = Object.fromEntries(request.headers["Upload-Metadata"].split(",").map((v) => {
        const [key, encoded] = v.split(" "); return [key, Buffer.from(encoded, "base64").toString()];
      }));
      assert.deepEqual(metadata, { bucketName: "private-guides", objectName: "demo/v1/video.mp4", contentType: "video/mp4", cacheControl: "3600" });
      return new Response(null, { status: 201, headers: { location: "/upload/fixture" } });
    }
    assert.equal(url, "https://storage.example/upload/fixture");
    if (request.method === "HEAD") return new Response(null, { status: 200, headers: { "upload-offset": String(offset) } });
    assert.equal(request.method, "PATCH");
    assert.equal(request.headers["Content-Type"], "application/offset+octet-stream");
    assert.equal(Number(request.headers["Upload-Offset"]), offset);
    assert.ok(request.body.length <= CHUNK);
    assert.deepEqual(request.body, bytes.subarray(offset, offset + request.body.length));
    received.push(Buffer.from(request.body));
    offset += request.body.length;
    return new Response(null, { status: 204, headers: { "upload-offset": String(offset) } });
  };
  const options = { base: "https://storage.example", bucket: "private-guides", auth: { Authorization: "Bearer synthetic-fixture" }, fetchImpl, wait: async (ms) => { delays.push(ms); } };
  const run = (overrides = {}) => uploadResumable("demo/v1/video.mp4", file, "video/mp4", { ...options, ...overrides });
  return { file, bytes, calls, delays, received, options, run, fetchImpl };
}

test("resumable upload sends exact multi-chunk bytes, metadata and short final chunk", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.run(), f.bytes.length);
  assert.equal(digest(Buffer.concat(f.received)), digest(f.bytes));
  assert.deepEqual(f.received.map((b) => b.length), [CHUNK, CHUNK, 17]);
  assert.deepEqual(f.calls.map((c) => c.method), ["DELETE", "POST", "PATCH", "PATCH", "PATCH"]);
  assert.deepEqual(f.delays, []);
});

test("partial PATCH recovery reads from the server's acknowledged byte", async (t) => {
  const f = await fixture(t);
  let offset = 0, dropped = false;
  const accepted = [], offsets = [];
  await f.run({ fetchImpl: async (url, request) => {
    if (request.method === "HEAD") return new Response(null, { headers: { "upload-offset": String(offset) } });
    if (request.method !== "PATCH") return f.fetchImpl(url, request);
    offsets.push(Number(request.headers["Upload-Offset"]));
    assert.equal(offsets.at(-1), offset);
    assert.deepEqual(request.body, f.bytes.subarray(offset, offset + request.body.length));
    if (!dropped) {
      dropped = true; accepted.push(Buffer.from(request.body.subarray(0, 113))); offset = 113;
      throw new Error("connection dropped after partial receipt");
    }
    accepted.push(Buffer.from(request.body)); offset += request.body.length;
    return new Response(null, { status: 204, headers: { "upload-offset": String(offset) } });
  } });
  assert.deepEqual(offsets, [0, 113, CHUNK + 113]);
  assert.deepEqual(f.delays, [2000]);
  assert.equal(digest(Buffer.concat(accepted)), digest(f.bytes));
});

test("a lost final acknowledgment completes from HEAD without sending the chunk again", async (t) => {
  const f = await fixture(t, 71);
  let patches = 0;
  await f.run({ fetchImpl: async (url, request) => {
    if (request.method === "PATCH") { patches++; throw Error("reply lost after receipt"); }
    if (request.method === "HEAD") return new Response(null, { headers: { "upload-offset": "71" } });
    return f.fetchImpl(url, request);
  } });
  assert.equal(patches, 1);
});

test("failed HEAD retries the same bytes and persistent failures stop after six PATCH attempts", async (t) => {
  const f = await fixture(t, 137);
  let patches = 0, heads = 0;
  await assert.rejects(f.run({ fetchImpl: async (url, request) => {
    if (request.method === "PATCH") {
      patches++; assert.equal(request.headers["Upload-Offset"], "0"); assert.deepEqual(request.body, f.bytes);
      return new Response("unavailable", { status: 503 });
    }
    if (request.method === "HEAD") { heads++; throw Error("offline"); }
    return f.fetchImpl(url, request);
  } }), /at 0: 503 unavailable/);
  assert.equal(patches, 6); assert.equal(heads, 5);
  assert.deepEqual(f.delays, [2000, 4000, 6000, 8000, 10000]);
});

test("invalid server resume offsets fail rather than skipping data or looping", async (t) => {
  const f = await fixture(t, 137);
  for (const offset of [null, "NaN", "-1", "138", "1.5", ""]) {
    await assert.rejects(f.run({ fetchImpl: async (url, request) => {
      if (request.method === "PATCH") throw Error("reply lost");
      if (request.method === "HEAD") return new Response(null, { headers: offset === null ? {} : { "upload-offset": offset } });
      return f.fetchImpl(url, request);
    } }), /invalid Upload-Offset/);
  }
});

test("a successful PATCH with no progress cannot report a completed upload", async (t) => {
  const f = await fixture(t, 137);
  let patches = 0;
  await assert.rejects(f.run({ fetchImpl: async (url, request) => {
    if (request.method === "PATCH") { patches++; return new Response(null, { status: 204, headers: { "upload-offset": "0" } }); }
    return f.fetchImpl(url, request);
  } }), /PATCH acknowledged an unexpected offset/);
  assert.equal(patches, 6);
});

test("source truncation fails explicitly instead of uploading uninitialized bytes", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.run({ fetchImpl: async (url, request) => {
    const response = await f.fetchImpl(url, request);
    if (request.method === "PATCH") await truncate(f.file, CHUNK);
    return response;
  } }), /source ended at 6291456, expected/);
  assert.equal(f.received.length, 1);
});

test("large source files only retain chunk-sized backing storage in PATCH requests", async (t) => {
  const f = await fixture(t, 0);
  const source = await open(f.file, "r+"); await source.truncate(64 * 1024 * 1024); await source.close();
  let offset = 0, patches = 0;
  await f.run({ fetchImpl: async (url, request) => {
    if (request.method === "POST") return new Response(null, { status: 201, headers: { location: "/upload/fixture" } });
    if (request.method !== "PATCH") return new Response(null);
    assert.ok(request.body.buffer.byteLength <= CHUNK, "must not retain a full-video backing buffer");
    assert.equal(Number(request.headers["Upload-Offset"]), offset);
    offset += request.body.length; patches++;
    return new Response(null, { status: 204, headers: { "upload-offset": String(offset) } });
  } });
  assert.equal(offset, 64 * 1024 * 1024); assert.equal(patches, 11);
});

test("source and creation failures stop before PATCH requests", async (t) => {
  const f = await fixture(t, 3);
  await rm(f.file);
  await assert.rejects(f.run(), /ENOENT/);
  assert.deepEqual(f.calls, []);
  await writeFile(f.file, "abc");
  await assert.rejects(f.run({ fetchImpl: async (_, request) => new Response(null, { status: request.method === "POST" ? 503 : 200 }) }), /503/);
  await assert.rejects(f.run({ fetchImpl: async (_, request) => new Response(null, { status: request.method === "POST" ? 201 : 200 }) }), /missing upload location/);
});

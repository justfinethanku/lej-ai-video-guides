import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { copyFile, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDemoServer } from "../scripts/demo-server.mjs";
import { staticFile } from "../scripts/static-files.mjs";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "guides-static-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "public");
  await mkdir(join(root, "nested"), { recursive: true });
  await writeFile(join(root, "index.html"), "<h1>Demo</h1>");
  await writeFile(join(root, "nested", "hello world.json"), '{"ok":true}');
  await writeFile(join(dir, "outside.txt"), "outside marker");
  await symlink(join(dir, "outside.txt"), join(root, "escape.txt"));
  await symlink(join(root, "index.html"), join(root, "inside.html"));
  return root;
}

test("static routes serve ordinary files, queries and safe internal symlinks", async (t) => {
  const root = await fixture(t);
  for (const url of ["/", "/index.html?cache=1", "http://localhost/inside.html"]) {
    const response = await staticFile(root, url);
    assert.equal(response.status, 200);
    assert.equal(response.body.toString(), "<h1>Demo</h1>");
    assert.match(response.contentType, /^text\/html/);
  }
  const json = await staticFile(root, "/nested/hello%20world.json");
  assert.equal(json.status, 200);
  assert.equal(json.contentType, "application/json");
  assert.equal((await staticFile(root, "/missing")).status, 404);
});

test("static routes reject malformed paths, encoded traversal and escaping symlinks", async (t) => {
  const root = await fixture(t);
  for (const url of ["/%", "/%E0%A4", "/%00", "/..%5coutside.txt"]) {
    assert.equal((await staticFile(root, url)).status, 400, url);
  }
  for (const url of ["/..%2foutside.txt", "/%2e%2e%2foutside.txt", "/escape.txt"]) {
    const response = await staticFile(root, url);
    assert.equal(response.status, 403, url);
    assert.equal(response.body, "Forbidden");
  }
});

test("HTTP demo stays alive after hostile requests and supports normal GET/HEAD", async (t) => {
  const server = createDemoServer(await fixture(t));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const get = (path, options = {}) => new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.address().port, path, ...options }, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal((await get("/%")).status, 400);
  assert.equal((await get("/escape.txt")).status, 403);
  assert.equal((await get("/", { headers: { Host: "attacker.example" } })).status, 403);
  assert.equal((await get("/", { method: "POST" })).status, 405);
  const normal = await get("/");
  assert.equal(normal.status, 200);
  assert.equal(normal.body, "<h1>Demo</h1>");
  assert.equal(normal.headers["x-content-type-options"], "nosniff");
  assert.equal((await get("/", { method: "HEAD", headers: { Host: "localhost:4400" } })).body, "");
});

test("demo CLI starts without a config and binds only IPv4 loopback", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "guides-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "scripts"));
  await mkdir(join(dir, "demo-app"));
  await writeFile(join(dir, "demo-app", "index.html"), "<h1>Relay Desk</h1>");
  for (const file of ["demo-server.mjs", "static-files.mjs"]) {
    await copyFile(new URL(`../scripts/${file}`, import.meta.url), join(dir, "scripts", file));
  }
  const child = spawn(process.execPath, [join(dir, "scripts", "demo-server.mjs")], {
    env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  });
  const [output] = await once(child.stdout, "data");
  const port = Number(output.toString().match(/localhost:(\d+)/)[1]);
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Relay Desk/);
  // Connecting via IPv6 would succeed for the original wildcard listener.
  await assert.rejects(fetch(`http://[::1]:${port}/`));
});

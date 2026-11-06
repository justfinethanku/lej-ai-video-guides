// Shared by the demo server and serveDir interception. Request URLs must stay inside the static root,
// including after resolving symlinks; malformed URLs are responses, not uncaught exceptions.
import { readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const inside = (root, file) => {
  const path = relative(root, file);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};

export async function staticFile(root, url) {
  let path;
  try {
    path = decodeURIComponent(new URL(url, "http://localhost").pathname);
    if (/[\0\\]/.test(path)) throw new Error("Invalid path");
  } catch {
    return { status: 400, body: "Bad request" };
  }
  const base = resolve(root);
  const file = resolve(base, `.${path}${path.endsWith("/") ? "index.html" : ""}`);
  if (!inside(base, file)) return { status: 403, body: "Forbidden" };
  try {
    const [realRoot, realFile] = await Promise.all([realpath(base), realpath(file)]);
    if (!inside(realRoot, realFile)) return { status: 403, body: "Forbidden" };
    return { status: 200, contentType: TYPES[extname(file)] ?? "application/octet-stream", body: await readFile(realFile) };
  } catch {
    return { status: 404, body: "Not found" };
  }
}

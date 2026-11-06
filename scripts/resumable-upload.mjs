// Read one Supabase TUS chunk at a time, including after a dropped PATCH's HEAD-resume.
// This module has no machine config or credentials, so the transport can be exercised offline.
import { open } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const CHUNK = 6 * 1024 * 1024;
const resumeOffset = (response, size) => {
  const raw = response.headers.get("upload-offset");
  const offset = Number(raw);
  if (raw === null || !/^\d+$/.test(raw) || !Number.isSafeInteger(offset) || offset > size) {
    throw new Error("invalid Upload-Offset");
  }
  return offset;
};

export async function uploadResumable(path, file, type, { base, bucket, auth, fetchImpl = fetch, wait = sleep }) {
  const source = await open(file, "r");
  try {
    const stat = await source.stat();
    if (!stat.isFile()) throw new Error(`resumable ${path}: source must be a regular file`);
    const size = stat.size;
    // Preserve the publisher's existing replacement behavior.
    await fetchImpl(`${base}/storage/v1/object/${bucket}/${path}`, { method: "DELETE", headers: auth }).catch(() => null);
    const b64 = (s) => Buffer.from(s).toString("base64");
    const meta = `bucketName ${b64(bucket)},objectName ${b64(path)},contentType ${b64(type)},cacheControl ${b64("3600")}`;
    const endpoint = `${base}/storage/v1/upload/resumable`;
    const start = await fetchImpl(endpoint, {
      method: "POST",
      headers: { ...auth, "Tus-Resumable": "1.0.0", "Upload-Length": String(size), "Upload-Metadata": meta, "x-upsert": "true" },
    });
    if (start.status !== 201) throw new Error(`resumable ${path}: ${start.status} ${(await start.text()).slice(0, 200)}`);
    const location = start.headers.get("location");
    if (!location) throw new Error(`resumable ${path}: missing upload location`);
    const at = new URL(location, endpoint).href;
    const buffer = Buffer.allocUnsafe(Math.min(CHUNK, size));
    let offset = 0;
    let failures = 0;
    while (offset < size) {
      const length = Math.min(buffer.length, size - offset);
      // Positioned reads let HEAD recovery seek to any acknowledged byte, including a partial chunk.
      let filled = 0;
      while (filled < length) {
        const { bytesRead } = await source.read(buffer, filled, length - filled, offset + filled);
        if (!bytesRead) throw new Error(`resumable ${path}: source ended at ${offset + filled}, expected ${size} bytes`);
        filled += bytesRead;
      }
      const piece = buffer.subarray(0, length);
      try {
        const res = await fetchImpl(at, {
          method: "PATCH",
          headers: { ...auth, "Tus-Resumable": "1.0.0", "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" },
          body: piece,
        });
        if (res.status !== 204) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
        const next = resumeOffset(res, size);
        if (next !== offset + length) throw new Error("PATCH acknowledged an unexpected offset");
        offset = next;
        failures = 0;
      } catch (e) {
        if (++failures > 5) throw new Error(`resumable ${path} at ${offset}: ${e.message}`);
        await wait(2000 * failures);
        const head = await fetchImpl(at, { method: "HEAD", headers: { ...auth, "Tus-Resumable": "1.0.0" } }).catch(() => null);
        if (head?.ok) offset = resumeOffset(head, size);
      }
    }
    return size;
  } finally {
    await source.close();
  }
}

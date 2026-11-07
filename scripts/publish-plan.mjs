import { basename } from "node:path";
import { createHash } from "node:crypto";
import { open, lstat } from "node:fs/promises";

// Select a still from the metadata saved with the rendered cut, in video seconds.
// Legacy callers can pass an entry from graphics/manifest.json explicitly.
export function stillTime(beat, metadata = beat.publish) {
  const overlay = metadata.overlays?.[0];
  const offset = metadata.graphic ? Math.max(0, beat.length - 0.7)
    : overlay ? Math.min(overlay.start + 1.2, (overlay.start + overlay.end) / 2)
    : beat.length * 0.6;
  return beat.start + offset;
}

// New render plans are commit markers, bound to the completed video's exact bytes.
// Legacy plans predate this guarantee; callers keep their explicit compatibility warning.
export async function verifyRender(plan, render, version) {
  if (plan.schema_version !== undefined && ![1, 2, 3].includes(plan.schema_version)) {
    throw new Error("Unsupported render plan schema");
  }
  if (plan.version !== version) throw new Error("Render plan version does not match requested version");
  if (plan.schema_version !== 3) {
    console.warn("Legacy render plan: render completion and integrity are unverified. Build a new cut version for verified artifacts.");
    return;
  }
  const receipt = plan.render;
  if (receipt?.status !== "complete" || receipt.file !== basename(render)
      || !Number.isSafeInteger(receipt.bytes) || receipt.bytes <= 0
      || !/^[a-f0-9]{64}$/.test(receipt.sha256 ?? "")) {
    throw new Error("Render plan has no completed video receipt; build a new rendered version");
  }
  const info = await lstat(render);
  if (!info.isFile() || info.size !== receipt.bytes) throw new Error("Render file does not match its receipt");
  const file = await open(render, "r");
  try {
    const opened = await file.stat();
    if (opened.dev !== info.dev || opened.ino !== info.ino || !opened.isFile()) {
      throw new Error("Render file changed during verification");
    }
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    if (hash.digest("hex") !== receipt.sha256) throw new Error("Render checksum does not match its receipt");
  } finally {
    await file.close();
  }
}

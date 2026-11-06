// Publishes one guide: the rendered video, its poster, and the written guide's pictures and motion clips.
//   node scripts/publish.mjs <slug> <version>
// The written guide is content/<slug>.md. In it, ![alt](shot:<beat>) becomes a still from the finished video during
// that beat (callouts included) and ![alt](loop:<beat>) becomes that beat as a short silent looping clip; both are
// rewritten to asset:<slug>/v<version>/<file>, which the site resolves to a real link when it shows the guide.
// Where it goes is guides.config.json "publish":
//   {"type": "supabase", "envFile", "bucket", "table"}: private Storage bucket + one row per guide (see site-example/).
//   {"type": "folder"}: <media>/<slug>/site/v<version>/ with the files, guide.json and body.md, for any site to serve.
// Files land under <slug>/v<version>/, so an older version's files stay put until removed.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG, CONTENT, media, script, STUDIO } from "./paths.mjs";
import { stillTime } from "./publish-plan.mjs";
import { uploadResumable } from "./resumable-upload.mjs";

const P = CONFIG.publish ?? { type: "folder" };
const SUPABASE = P.type === "supabase";
const BUCKET = P.bucket ?? "guides";
const TABLE = P.table ?? "guides";
let BASE = "";
let auth = {};
if (SUPABASE) {
  const envFile = join(STUDIO, P.envFile ?? "../.env.local");
  if (!existsSync(envFile)) throw new Error(`publish.envFile ${envFile} not found`);
  const env = Object.fromEntries(
    readFileSync(envFile, "utf8")
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "").trim()]),
  );
  BASE = env.SUPABASE_URL;
  const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  auth = { apikey: KEY, Authorization: `Bearer ${KEY}` };
}

async function upload(path, file, type) {
  const size = statSync(file).size;
  if (!SUPABASE) {
    // Folder publish: <media>/<slug>/site/v<version>/<file>, same layout as the bucket.
    copyFileSync(file, media(path.split("/")[0], "site", ...path.split("/").slice(1)));
    console.log(`  ${path}  ${(size / 1e6).toFixed(1)} MB (folder)`);
    return;
  }
  if (size > 20e6) {
    await uploadResumable(path, file, type, { base: BASE, bucket: BUCKET, auth });
    console.log(`  ${path}  ${(size / 1e6).toFixed(1)} MB (resumable)`);
    return;
  }
  // Storage drops a connection now and then; the upload replaces the object, so trying again is safe.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${BASE}/storage/v1/object/${BUCKET}/${path}`, {
        method: "POST",
        headers: { ...auth, "Content-Type": type, "x-upsert": "true", "cache-control": "max-age=3600" },
        body: readFileSync(file),
        duplex: "half",
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      break;
    } catch (e) {
      if (attempt >= 4) throw new Error(`upload ${path} (${(size / 1e6).toFixed(1)} MB): ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  console.log(`  ${path}  ${(size / 1e6).toFixed(1)} MB`);
}

const ff = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);

const [slug, v] = process.argv.slice(2);
const version = Number(v);
const guide = script(slug);
const plan = JSON.parse(readFileSync(media(slug, "renders", `${slug}-guide-v${version}.plan.json`), "utf8"));
// New plans carry the graphics metadata for this cut. Only older plans need the mutable manifest.
let manifest;
if (plan.beats.some((beat) => !beat.publish)) {
  console.warn("Legacy edit plan: still selection uses the current graphics manifest. Rebuild the cut with a new version to snapshot its metadata.");
  manifest = JSON.parse(readFileSync(media(slug, "graphics", "manifest.json"), "utf8"));
}
const render = media(slug, "renders", `${slug}-guide-v${version}.mp4`);
const beatAt = Object.fromEntries(plan.beats.map((b) => [b.id, b]));
const dir = `${slug}/v${version}`;
const out = (name) => media(slug, "publish", `v${version}`, name);

// The written guide's pictures: a still where the beat's first callout is fully up, else 60% of the way in.
let body = readFileSync(join(CONTENT, `${slug}.md`), "utf8");
const refs = [...body.matchAll(/\]\((shot|loop):([a-z0-9]+)\)/g)].map((m) => ({ kind: m[1], beat: m[2] }));
for (const { kind, beat } of refs) {
  const b = beatAt[beat];
  if (!b) throw new Error(`${slug}.md refers to ${kind}:${beat}, which is not a beat in the video`);
  if (kind === "shot") {
    // A graphic (title card, flow diagram) is fully drawn just before its fade-out; a screen beat is shown where its
    // first callout is up, else 60% of the way in.
    const t = stillTime(b, b.publish ?? manifest?.[beat] ?? {});
    const file = out(`${beat}-shot.jpg`);
    ff("-ss", t.toFixed(2), "-i", render, "-frames:v", "1", "-vf", "scale=1600:-2", "-q:v", "3", file);
    await upload(`${dir}/${beat}-shot.jpg`, file, "image/jpeg");
    body = body.replaceAll(`(shot:${beat})`, `(asset:${dir}/${beat}-shot.jpg)`);
  } else {
    const file = out(`${beat}-loop.mp4`);
    ff("-ss", (b.start + 0.2).toFixed(2), "-t", Math.max(1, b.length - 0.5).toFixed(2), "-i", render, "-an", "-vf", "scale=1280:-2", "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file);
    await upload(`${dir}/${beat}-loop.mp4`, file, "video/mp4");
    body = body.replaceAll(`(loop:${beat})`, `(asset:${dir}/${beat}-loop.mp4)`);
  }
}

// The video and its poster (the title card, fully drawn).
const poster = out("poster.jpg");
ff("-ss", "3", "-i", render, "-frames:v", "1", "-vf", "scale=1920:-2", "-q:v", "2", poster);
await upload(`${dir}/poster.jpg`, poster, "image/jpeg");
await upload(`${dir}/${slug}-guide-v${version}.mp4`, render, "video/mp4");

const row = {
  slug,
  position: guide.position,
  title: guide.title,
  summary: guide.summary,
  video_path: `${dir}/${slug}-guide-v${version}.mp4`,
  poster_path: `${dir}/poster.jpg`,
  video_seconds: Math.round(plan.seconds),
  body_md: body,
  as_of: guide.asOf,
  version,
  hidden: false,
  updated_by: P.updatedBy ?? "guides studio publish.mjs",
  updated_at: new Date().toISOString(),
};
if (SUPABASE) {
  const res = await fetch(`${BASE}/rest/v1/${TABLE}?on_conflict=slug`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`${TABLE} row: ${res.status} ${await res.text()}`);
} else {
  writeFileSync(media(slug, "site", `v${version}`, "guide.json"), JSON.stringify(row, null, 2));
  writeFileSync(media(slug, "site", `v${version}`, "body.md"), body);
}
console.log(`${slug} v${version} published (${P.type}): ${refs.length} pictures and clips, ${Math.round(plan.seconds)} s of video`);

// Checks everything the kit needs and says what to do about anything missing. pnpm doctor
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG, MEDIA, STUDIO } from "./paths.mjs";

const results = [];
const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push([true, name, detail ?? ""]);
  } catch (e) {
    results.push([false, name, e.message]);
  }
};
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.error || r.status !== 0) throw new Error((r.stderr || r.error?.message || "failed").trim().split("\n")[0]);
  return (r.stdout || r.stderr).trim().split("\n")[0];
};

await check("Node 20 or newer", () => {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) throw new Error(`Node ${process.versions.node}. Install Node 20+ from nodejs.org.`);
  return `Node ${process.versions.node}`;
});
await check("ffmpeg and ffprobe", () => {
  run("ffprobe", ["-version"]);
  return run("ffmpeg", ["-version"]).replace(/ Copyright.*/, "");
});
await check("Chromium for filming", () => {
  const caches = [join(homedir(), "Library/Caches/ms-playwright"), join(homedir(), ".cache/ms-playwright")].filter(existsSync);
  const found = caches.flatMap((c) => readdirSync(c).filter((d) => /^chromium-\d+$/.test(d)));
  if (!found.length && !existsSync("/Applications/Google Chrome.app")) throw new Error("Run: npx playwright-core install chromium");
  return found.length ? found.sort().pop() : "system Chrome";
});
await check("Project dependencies", () => {
  if (!existsSync(join(STUDIO, "node_modules", "remotion"))) throw new Error("Run: pnpm install");
  return "installed";
});
await check("guides.config.json", () => `${CONFIG.product} · ${CONFIG.site}`);
await check("ElevenLabs key", async () => {
  const name = CONFIG.voice?.keyEnv ?? "ELEVENLABS_API_KEY";
  const key = process.env[name];
  if (!key) throw new Error(`Set ${name} in .env (next to guides.config.json). Get a key at elevenlabs.io/app/settings/api-keys.`);
  const res = await fetch(`https://api.elevenlabs.io/v1/voices/${CONFIG.voice.id}`, { headers: { "xi-api-key": key } });
  if (res.status === 401) throw new Error("ElevenLabs rejected the key. Check it, and that it can use Text to Speech and Voices.");
  if (!res.ok) throw new Error(`Voice ${CONFIG.voice.id}: ${res.status}. Check voice.id in the config.`);
  const v = await res.json();
  return `voice "${v.name}" · model ${CONFIG.voice.model ?? "eleven_v4"}`;
});
await check("Media folder", () => {
  return MEDIA;
});
await check("Music bed", () => {
  if (!CONFIG.music) return "none (config has no music)";
  const f = join(MEDIA, CONFIG.music.file);
  if (!existsSync(f)) throw new Error(`${f} not found. Run: pnpm music (or put your own track there).`);
  return CONFIG.music.file;
});
await check("DaVinci Resolve Studio scripting", () => {
  const py = `
import sys, os
sys.path.append("/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules")
sys.path.append(os.path.expandvars("%PROGRAMDATA%/Blackmagic Design/DaVinci Resolve/Support/Developer/Scripting/Modules"))
sys.path.append("/opt/resolve/Developer/Scripting/Modules")
import DaVinciResolveScript as d
r = d.scriptapp("Resolve")
print(r.GetProductName() + " " + r.GetVersionString() if r else "NOT_RUNNING")`;
  const out = run("python3", ["-c", py]);
  if (out === "NOT_RUNNING") throw new Error("Resolve isn't reachable. Open DaVinci Resolve Studio and set Preferences > System > General > External scripting using: Local.");
  if (!/Studio/i.test(out)) throw new Error(`${out}: external scripting needs DaVinci Resolve Studio (the paid version).`);
  return out;
});
if ((CONFIG.session?.from ?? "none") === "chrome") {
  await check("Signed-in Chrome", async () => {
    const port = CONFIG.session.cdpPort ?? 9222;
    const res = await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null);
    if (!res?.ok) throw new Error(`No Chrome on port ${port}. Run: pnpm chrome, then sign in to your app there.`);
    return `Chrome on port ${port}`;
  });
}

for (const [ok, name, detail] of results) console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
const failed = results.filter((r) => !r[0]).length;
console.log(failed ? `\n${failed} to fix. Fix the ✗ lines, then run pnpm doctor again.` : "\nReady. Next: pnpm voice <page>");
process.exit(failed ? 1 : 0);

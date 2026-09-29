// Generates the music bed that runs quietly under every guide, with ElevenLabs Music. pnpm music [seconds]
// Writes <media>/<music.file> (the config's music.file). One bed per product is plenty; it loops under long videos.
import { writeFileSync } from "node:fs";
import { CONFIG, media } from "./paths.mjs";

const seconds = Number(process.argv[2] ?? 480);
const key = process.env[CONFIG.voice?.keyEnv ?? "ELEVENLABS_API_KEY"];
if (!key) throw new Error("Set ELEVENLABS_API_KEY in .env first.");
const prompt =
  CONFIG.music?.prompt ??
  "Subtle, warm, minimal background music to sit under a calm spoken software tutorial. Soft felt piano, gentle warm pads and a light, steady pulse. Around 85 BPM. No drums, no vocals, no big melody or hooks, no builds or drops, no sudden changes. Low energy, unobtrusive and consistent from start to finish, so a voice sits clearly on top. Clean, modern, reassuring.";
const res = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_48000_192", {
  method: "POST",
  headers: { "xi-api-key": key, "Content-Type": "application/json" },
  body: JSON.stringify({ model_id: CONFIG.music?.model ?? "music_v2_5", force_instrumental: true, music_length_ms: seconds * 1000, prompt }),
});
if (!res.ok) throw new Error(`ElevenLabs Music: ${res.status} ${(await res.text()).slice(0, 300)}`);
const out = media(CONFIG.music?.file ?? "music/bed-v1.mp3");
writeFileSync(out, Buffer.from(await res.arrayBuffer()));
console.log(`Music bed: ${out} (${seconds} s). Listen once before using it.`);

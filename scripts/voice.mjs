// Voiceover: one WAV per beat, with word timings, from ElevenLabs (voice, model and settings in guides.config.json).
//   node scripts/voice.mjs <slug> [beatId ...]
// A beat whose text has not changed since its last take is skipped (its .json keeps the text's hash), so re-running
// after editing one line re-voices only that line. The key comes from the environment variable named by voice.keyEnv
// (default ELEVENLABS_API_KEY), which may also be set in a .env file next to the config.
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CONFIG, media, script } from "./paths.mjs";

const V = CONFIG.voice;
export const VOICE = V.id;
export const MODEL = V.model ?? "eleven_v4";
// Steadier than the default: these are instructions, not a performance.
export const SETTINGS = { stability: V.stability ?? 0.65, similarity_boost: V.similarity ?? 0.8 };
const LUFS = V.lufs ?? -16;

/** Plain gain (plus a safety limiter) so every take sits at voice.lufs (-16, the usual level for spoken web video). */
export function level(wav) {
  // ffmpeg prints the loudness summary on stderr.
  const report = spawnSync("ffmpeg", ["-hide_banner", "-i", wav, "-af", "ebur128=framelog=quiet", "-f", "null", "-"]).stderr.toString();
  const measured = [...report.matchAll(/ I:\s+(-?[\d.]+) LUFS/g)].pop();
  if (!measured) return;
  const gain = (LUFS - Number(measured[1])).toFixed(2);
  const tmp = `${wav}.tmp.wav`;
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", wav, "-af", `volume=${gain}dB,alimiter=limit=0.89:level=false`, "-ar", "48000", tmp]);
  execFileSync("mv", [tmp, wav]);
}

const key = () => {
  const name = V.keyEnv ?? "ELEVENLABS_API_KEY";
  if (!process.env[name]) throw new Error(`Set ${name} (in your shell, or in .env next to guides.config.json).`);
  return process.env[name];
};

/** Words with start and end seconds, rebuilt from ElevenLabs' per-character alignment. */
export function wordsFrom(alignment) {
  const words = [];
  let cur = null;
  alignment.characters.forEach((ch, i) => {
    const s = alignment.character_start_times_seconds[i];
    const e = alignment.character_end_times_seconds[i];
    if (/\s/.test(ch)) {
      if (cur) words.push(cur);
      cur = null;
      return;
    }
    if (!cur) cur = { text: "", start: s, end: e };
    cur.text += ch;
    cur.end = e;
  });
  if (cur) words.push(cur);
  return words;
}

async function voice(beat, prev, next, apiKey) {
  const body = { text: beat.say, model_id: MODEL, voice_settings: SETTINGS };
  if (prev) body.previous_text = prev;
  if (next) body.next_text = next;
  let res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=pcm_48000`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok && (prev || next)) {
    // Some models refuse the neighbouring-text hints; take the line on its own.
    delete body.previous_text;
    delete body.next_text;
    res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=pcm_48000`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  if (!res.ok) throw new Error(`${beat.id}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [slug, ...only] = process.argv.slice(2);
  const guide = script(slug);
  const apiKey = key();
  const spoken = guide.beats.filter((b) => b.say);
  for (const [i, beat] of spoken.entries()) {
    if (only.length && !only.includes(beat.id)) continue;
    const hash = createHash("sha1").update(`${MODEL}|${VOICE}|${JSON.stringify(SETTINGS)}|${beat.say}`).digest("hex").slice(0, 12);
    const meta = media(slug, "vo", `${beat.id}.json`);
    if (existsSync(meta) && JSON.parse(readFileSync(meta, "utf8")).hash === hash) continue;
    const out = await voice(beat, spoken[i - 1]?.say, spoken[i + 1]?.say, apiKey);
    const pcm = media(slug, "vo", `${beat.id}.pcm`);
    writeFileSync(pcm, Buffer.from(out.audio_base64, "base64"));
    const wav = media(slug, "vo", `${beat.id}.wav`);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "s16le", "-ar", "48000", "-ac", "1", "-i", pcm, wav]);
    execFileSync("rm", [pcm]);
    level(wav);
    const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav]).toString());
    writeFileSync(meta, JSON.stringify({ id: beat.id, hash, say: beat.say, seconds, words: wordsFrom(out.alignment) }, null, 2));
    console.log(`${beat.id}  ${seconds.toFixed(1)} s`);
  }
}

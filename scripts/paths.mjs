// Where everything lives, from guides.config.json next to this kit (copy guides.config.example.json to start).
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const STUDIO = join(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(STUDIO, "guides.config.json");
if (!existsSync(configPath)) throw new Error(`No ${configPath}. Copy guides.config.example.json to guides.config.json and fill it in.`);
export const CONFIG = JSON.parse(readFileSync(configPath, "utf8"));

// KEY=value lines from .env next to the config (secrets stay out of the config and out of git).
const envPath = join(STUDIO, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const home = (p) => p.replace(/^~(?=\/)/, process.env.HOME);

// Scripts (what is said and shown) are text: they live in git, in content/.
export const CONTENT = join(STUDIO, "content");
// Media (voice, captures, graphics, renders, timelines, Resolve exports) is too big for git: it lives in the
// production folder named in the config (override with GUIDES_MEDIA).
export const MEDIA = home(process.env.GUIDES_MEDIA ?? CONFIG.media);

export const media = (...parts) => {
  const p = join(MEDIA, ...parts);
  mkdirSync(dirname(p), { recursive: true });
  return p;
};

export const script = (slug) => JSON.parse(readFileSync(join(CONTENT, `${slug}.json`), "utf8"));

export const FPS = 30;

// The product's own look, from guides.config.json "brand", so the graphics look like the app they explain.
// The font loads from Google Fonts by the name in brand.font when it's one of the families imported below; any other
// font must be installed on the machine (Chrome finds it by name). Add a loader here for another Google font.
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import config from "../guides.config.json";

const b = (config as { brand?: Record<string, string | number> }).brand ?? {};
const family = String(b.font ?? "Inter");
export const fontFamily = family === "Inter" ? loadInter("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] }).fontFamily : family;

export const T = {
  green: String(b.accent ?? "#14a155"), // the accent: callout rings, step numbers
  text: String(b.text ?? "#333333"),
  muted: String(b.muted ?? "#71717a"),
  line: String(b.line ?? "#dfdfdf"),
  white: String(b.background ?? "#ffffff"),
  // The dim laid over the screen around a highlighted area.
  dim: "rgba(17, 17, 17, 0.55)",
};

export const BRAND = {
  product: String((config as { product?: string }).product ?? ""),
  // The small line above the page name on the title card; defaults to "<product> guide".
  kicker: (config as { kicker?: string }).kicker,
  logo: b.logo ? String(b.logo) : null,
  logoHeight: Number(b.logoHeight ?? 56),
  wordmark: b.wordmark ? String(b.wordmark) : null,
  wordmarkHeight: Number(b.wordmarkHeight ?? 28),
};

export const W = 1920;
export const H = 1080;
export const FPS = 30;

// A headless browser at filming size, signed in to the app if the config says how.
//
// session.from = "chrome": film an app that needs a sign-in. Start a separate Chrome profile with a debugging port
//   (pnpm chrome, or: open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir="$HOME/.guides-chrome")
//   and sign in to the app there once. Filming reads that profile's cookies for session.host over the port, keeps
//   them in memory only, and films in its own headless window, so your Chrome is left alone and no password is typed.
// session.from = "none": a public app or a local demo, no sign-in.
// serveDir (optional): a folder of static files to film at the site URL without running a server (the demo uses it).
import { chromium } from "playwright-core";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, normalize } from "node:path";
import { CONFIG, STUDIO } from "./paths.mjs";

export const SITE = process.env.GUIDES_SITE ?? CONFIG.site;
// Laid out at viewport CSS px and drawn at `scale`, so frames are sharp at 1080p with room to zoom.
export const VIEW = { width: CONFIG.viewport?.width ?? 1440, height: CONFIG.viewport?.height ?? 810 };
export const SCALE = CONFIG.viewport?.scale ?? 2;

/** Playwright's own Chromium (npx playwright-core install chromium), newest first; the system Chrome as a fallback. */
function chromePath() {
  const caches = [join(homedir(), "Library/Caches/ms-playwright"), join(homedir(), ".cache/ms-playwright")];
  for (const cache of caches.filter(existsSync)) {
    const builds = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const b of builds) {
      for (const p of [
        join(cache, b, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
        join(cache, b, "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
        join(cache, b, "chrome-linux64/chrome"),
        join(cache, b, "chrome-linux/chrome"),
      ]) {
        if (existsSync(p)) return p;
      }
    }
  }
  const system = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(system)) return system;
  throw new Error("No Chromium found. Run: npx playwright-core install chromium");
}

async function sessionCookies(host) {
  const port = CONFIG.session?.cdpPort ?? 9222;
  let chrome;
  try {
    chrome = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  } catch {
    throw new Error(`No Chrome with a debugging port on ${port}. Run: pnpm chrome, then sign in to ${host} in that window.`);
  }
  const cookies = (await chrome.contexts()[0].cookies()).filter((c) => c.domain.replace(/^\./, "") === host);
  await chrome.close(); // disconnects only; your Chrome keeps running
  if (!cookies.length) throw new Error(`That Chrome profile has no ${host} session. Sign in to the app there first.`);
  return cookies;
}

/** A signed-in page at the filming size, plus the browser to close afterwards. */
export async function openSite() {
  const from = CONFIG.session?.from ?? "none";
  let cookies = [];
  if (from === "chrome") {
    // A local dev server that reads the same backend can reuse the production session (GUIDES_SITE=http://localhost:3000).
    const local = new URL(SITE).hostname === "localhost";
    const host = CONFIG.session.host ?? new URL(CONFIG.site).hostname;
    cookies = (await sessionCookies(host)).map((c) => (local ? { name: c.name, value: c.value, domain: "localhost", path: "/", httpOnly: c.httpOnly, secure: false, sameSite: "Lax" } : c));
  }
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--hide-scrollbars", "--force-color-profile=srgb"] });
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, colorScheme: "light", timezoneId: CONFIG.timezone ?? "America/New_York", locale: "en-US" });
  if (cookies.length) await context.addCookies(cookies);
  // serveDir: film a static folder (like demo-app/) at the site URL with no server running; the browser is handed
  // the files directly.
  if (CONFIG.serveDir) {
    const root = join(STUDIO, CONFIG.serveDir);
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
    await context.route(`${new URL(SITE).origin}/**`, (route) => {
      const path = normalize(decodeURIComponent(new URL(route.request().url()).pathname)).replace(/^(\.\.[/\\])+/, "");
      const file = join(root, path.endsWith("/") ? `${path}index.html` : path);
      if (!existsSync(file)) return route.fulfill({ status: 404, body: "Not found" });
      return route.fulfill({ status: 200, contentType: types[extname(file)] ?? "application/octet-stream", body: readFileSync(file) });
    });
  }
  const page = await context.newPage();
  return { browser, context, page };
}

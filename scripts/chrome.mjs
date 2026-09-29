// Opens a separate Chrome profile with a debugging port, for filming apps that need a sign-in (session.from: "chrome").
// Sign in to your app in the window that opens; filming reads that profile's cookies. pnpm chrome
import { spawn } from "node:child_process";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { CONFIG } from "./paths.mjs";

const port = String(CONFIG.session?.cdpPort ?? 9222);
const profile = join(homedir(), ".guides-chrome");
const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, CONFIG.site];
if (platform() === "darwin") {
  spawn("open", ["-na", "Google Chrome", "--args", ...args], { stdio: "inherit" });
} else {
  spawn("google-chrome", args, { stdio: "inherit", detached: true }).unref();
}
console.log(`Chrome (profile ${profile}) on port ${port}. Sign in to ${CONFIG.site} there, then film.`);

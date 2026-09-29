// Screenshots of pages at filming size, for planning shots: node scripts/look.mjs /mail /ask ...
import { openSite, SITE } from "./browser.mjs";
const { browser, page } = await openSite();
for (const path of process.argv.slice(2)) {
  await page.goto(SITE + path, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(3500);
  const name = path.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home";
  await page.screenshot({ path: `out/look/${name}.png`, scale: "css" });
  console.log(path, "->", page.url());
}
await browser.close();

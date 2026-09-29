// The Guides page (/guides, table `guides` from guides.sql): loading the rows and signing their videos and pictures.
import { rest } from "./supabase-rest";

export type GuideRow = {
  slug: string;
  position: number;
  title: string;
  summary: string;
  video_path: string | null;
  poster_path: string | null;
  video_seconds: number | null;
  body_md: string;
  as_of: string;
  version: number;
};

export type Guide = GuideRow & { video: string | null; poster: string | null; assets: Record<string, string> };

const ASSET = /asset:([A-Za-z0-9/_.-]+)/g;
// Long enough that a video paused over lunch still plays; the page is behind the sign-in.
const SIGNED_FOR_SECONDS = 12 * 60 * 60;

/** Every bucket path a guide needs signed: its video, its poster, and each asset: reference in its text. */
export function assetPaths(row: GuideRow): string[] {
  const paths = new Set<string>();
  if (row.video_path) paths.add(row.video_path);
  if (row.poster_path) paths.add(row.poster_path);
  for (const match of row.body_md.matchAll(ASSET)) paths.add(match[1]);
  return [...paths];
}

/** The link to show for a picture in a written guide: asset:<path> becomes its signed link (the Markdown keeps the
 *  short asset: form, because a signed link is too long for the Markdown parser to take as an image). */
export function assetUrl(src: string, signed: Record<string, string>): string {
  return src.startsWith("asset:") ? signed[src.slice("asset:".length)] ?? "" : src;
}

/** True for a link to a video file (the written guide's motion loops), ignoring the signing query. */
export function isVideo(src: string): boolean {
  return /\.(mp4|webm|mov)$/i.test(src.split("?")[0]);
}

/** "12 min" / "4 min 30 s" for the video's running time. */
export function runningTime(seconds: number | null): string | null {
  if (!seconds || seconds < 1) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s} s`;
  return s ? `${m} min ${s} s` : `${m} min`;
}

/** "Sep 28, 2026" from "2026-09-28", read as a calendar date. */
export function asOfLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Signs many objects in bucket `guides` in one call. */
async function signAll(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  // Trimmed: an environment value with a trailing line break splits every signed link built from it.
  const base = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server");
  const response = await fetch(`${base}/storage/v1/object/sign/guides`, {
    method: "POST",
    cache: "no-store",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: SIGNED_FOR_SECONDS, paths }),
  });
  if (!response.ok) return out;
  const rows = (await response.json()) as { path: string | null; signedURL: string | null; error: string | null }[];
  for (const row of rows) {
    if (!row.path || !row.signedURL) continue;
    out.set(row.path, row.signedURL.startsWith("http") ? row.signedURL : `${base}/storage/v1${row.signedURL}`);
  }
  return out;
}

/** The guides in page order, each with signed links for its video, poster and pictures. */
export async function loadGuides(): Promise<Guide[]> {
  const rows = await rest<GuideRow[]>(
    "guides?select=slug,position,title,summary,video_path,poster_path,video_seconds,body_md,as_of,version&hidden=is.false&order=position",
  );
  const signed = await signAll([...new Set(rows.flatMap(assetPaths))]);
  return rows.map((row) => ({
    ...row,
    video: row.video_path ? signed.get(row.video_path) ?? null : null,
    poster: row.poster_path ? signed.get(row.poster_path) ?? null : null,
    assets: Object.fromEntries(assetPaths(row).map((path) => [path, signed.get(path) ?? ""])),
  }));
}

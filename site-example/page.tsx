import type { Metadata } from "next";
import { redirect } from "next/navigation";
import ReactMarkdown, { type Components, defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { sessionUserId } from "@/lib/auth"; // your app's own "who is signed in" check
import { asOfLabel, assetUrl, isVideo, loadGuides, runningTime } from "@/lib/guides"; // guides.ts
import "./guides.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Guides" };

// Pictures in the written guides: screenshots as images, motion loops (.mp4) as silent looping video. Their Markdown
// says asset:<path>; the signed link for this visit replaces it here.
function pictures(signed: Record<string, string>): Components {
  return {
    img: ({ src, alt }) => {
      const url = assetUrl(typeof src === "string" ? src : "", signed);
      if (!url) return null;
      if (isVideo(url)) {
        return <video className="gd-loop" src={url} autoPlay muted loop playsInline aria-label={alt || undefined} />;
      }
      return <img className="gd-shot" src={url} alt={alt || ""} loading="lazy" />;
    },
  };
}

// Let asset: through (the default drops unknown schemes); everything else gets the usual safety check.
const keepAssets = (url: string) => (url.startsWith("asset:") ? url : defaultUrlTransform(url));

/** One section per page of the site: its name, the narrated video, and the written guide folded underneath. */
export default async function GuidesPage() {
  const [userId, guides] = await Promise.all([sessionUserId(), loadGuides()]);
  if (!userId) redirect("/login");
  return (
    <main className="ui-page gd-page">
      <div className="ui-header">
        <div>
          <h1>Guides</h1>
        </div>
      </div>
      <p className="gd-intro">A narrated video and a written guide for each page. Watch the video first; open the written guide when you want the steps in front of you.</p>
      {guides.length ? (
        <nav className="gd-toc" aria-label="Guides on this page">
          {guides.map((guide) => (
            <a key={guide.slug} href={`#${guide.slug}`}>
              {guide.title}
            </a>
          ))}
        </nav>
      ) : (
        <p className="ui-empty">No guides yet.</p>
      )}
      {guides.map((guide) => {
        const length = runningTime(guide.video_seconds);
        return (
          <section key={guide.slug} id={guide.slug} className="gd-guide">
            <h2 className="gd-title">{guide.title}</h2>
            <p className="gd-summary">{guide.summary}</p>
            <p className="ui-muted">
              As of {asOfLabel(guide.as_of)}
              {length ? ` · ${length}` : ""}
            </p>
            {guide.video ? (
              <video className="gd-video" src={guide.video} poster={guide.poster ?? undefined} controls preload="metadata" playsInline />
            ) : (
              <p className="gd-pending">The video for this page is being made.</p>
            )}
            {guide.body_md ? (
              <details className="gd-written">
                <summary>Written guide</summary>
                <div className="gd-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={pictures(guide.assets)} urlTransform={keepAssets}>
                    {guide.body_md}
                  </ReactMarkdown>
                </div>
              </details>
            ) : null}
          </section>
        );
      })}
    </main>
  );
}

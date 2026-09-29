import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND, fontFamily, T } from "./theme";

export type TitleCardProps = {
  /** The page's name as the nav shows it: "Ask". */
  page: string;
  /** What the page is for, one sentence. */
  purpose: string;
  /** The video's chapters, so the viewer knows what's coming. */
  chapters: string[];
  /** "As of Sep 28, 2026": guides are dated so a stale one is obvious. */
  asOf: string;
};

/** The opening card: logo (brand.logo, brand.wordmark in public/), page name, what it's for, and the chapters ahead. */
export const TitleCard: React.FC<TitleCardProps> = ({ page, purpose, chapters, asOf }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const a = (d: number) => spring({ frame: frame - d, fps, config: { damping: 200 }, durationInFrames: 18 });
  const out = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const up = (v: number) => ({ opacity: v, transform: `translateY(${interpolate(v, [0, 1], [16, 0])}px)` });

  return (
    <AbsoluteFill style={{ background: T.white, fontFamily, color: T.text, opacity: out }}>
      <div style={{ position: "absolute", left: 140, top: 110, display: "flex", alignItems: "center", gap: 18, ...up(a(0)) }}>
        {BRAND.logo ? <Img src={staticFile(BRAND.logo)} style={{ height: BRAND.logoHeight }} /> : null}
        {BRAND.wordmark ? <Img src={staticFile(BRAND.wordmark)} style={{ height: BRAND.wordmarkHeight }} /> : null}
      </div>
      <div style={{ position: "absolute", left: 140, top: 290, width: 1100 }}>
        <div style={{ fontSize: 30, lineHeight: "36px", color: T.muted, ...up(a(6)) }}>{BRAND.kicker ?? (BRAND.product ? `${BRAND.product} guide` : "Guide")}</div>
        <div style={{ fontSize: 132, lineHeight: "140px", fontWeight: 700, letterSpacing: -2, marginTop: 10, ...up(a(10)) }}>{page}</div>
        <div style={{ fontSize: 40, lineHeight: "54px", marginTop: 24, ...up(a(16)) }}>{purpose}</div>
      </div>
      <div style={{ position: "absolute", left: 1320, top: 300, width: 480 }}>
        <div style={{ fontSize: 26, lineHeight: "32px", color: T.muted, ...up(a(22)) }}>In this video</div>
        {chapters.map((c, i) => (
          <div key={c} style={{ display: "flex", gap: 16, fontSize: 30, lineHeight: "40px", marginTop: 16, ...up(a(26 + i * 4)) }}>
            <span style={{ color: T.green, fontWeight: 600, width: 28 }}>{i + 1}</span>
            <span>{c}</span>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 140, bottom: 100, fontSize: 24, color: T.muted, ...up(a(30)) }}>{asOf}</div>
    </AbsoluteFill>
  );
};

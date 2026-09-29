import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { fontFamily, T } from "./theme";

export type StillProps = {
  /** An image in public/ (graphics.mjs copies a beat's image there before rendering). */
  src: string;
  /** Optional line under the image: what the viewer is looking at. */
  caption?: string;
  /** How far the slow push-in goes by the end (1.0 = none). */
  zoom?: number;
  /** Which part of the image stays in frame when it's cropped (CSS object-position), e.g. "center bottom". */
  position?: string;
};

/** A screenshot or photo, framed on the brand background, with a slow push-in and an optional caption. */
export const Still: React.FC<StillProps> = ({ src, caption, zoom = 1.06, position = "top center" }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const inn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 16 });
  const out = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale = interpolate(frame, [0, durationInFrames], [1, zoom]);
  return (
    <AbsoluteFill style={{ background: T.white, fontFamily, color: T.text, opacity: out }}>
      <div style={{ position: "absolute", left: 120, right: 120, top: caption ? 80 : 110, bottom: caption ? 190 : 110, overflow: "hidden", borderRadius: 16, border: `1px solid ${T.line}`, opacity: inn }}>
        <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: position, transform: `scale(${scale})`, transformOrigin: "50% 30%" }} />
      </div>
      {caption ? (
        <div style={{ position: "absolute", left: 120, right: 120, bottom: 90, fontSize: 38, lineHeight: "50px", fontWeight: 600, opacity: inn, transform: `translateY(${interpolate(inn, [0, 1], [12, 0])}px)` }}>{caption}</div>
      ) : null}
    </AbsoluteFill>
  );
};

import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fontFamily, T, W, H } from "./theme";

export type Box = { x: number; y: number; w: number; h: number };

export type CalloutProps = {
  /** Area to point at, in 1920x1080 frame pixels (capture.mjs writes these from the page's own element boxes). */
  box: Box;
  /** What the area is, in a few words. */
  label: string;
  /** Optional second line: what to do with it. */
  note?: string;
  /** Where the label sits relative to the box. */
  side?: "top" | "bottom" | "left" | "right";
  /** Dim the rest of the screen so the eye lands on the box. */
  dim?: boolean;
  /** A still of the screen underneath. Set only when rendering an annotated still for the written guide; the video
   *  version is transparent and sits on top of the screen recording in Resolve. */
  background?: string;
};

const PAD = 8;

/** A highlight ring around one area of the screen with a short label next to it. Transparent everywhere else. */
export const Callout: React.FC<CalloutProps> = ({ box, label, note, side = "bottom", dim = true, background }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const still = !!background;
  const enter = still ? 1 : spring({ frame, fps, config: { damping: 200 }, durationInFrames: 14 });
  const exit = still ? 1 : interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const o = enter * exit;
  const grow = interpolate(enter, [0, 1], [10, 0]);

  const r = { x: box.x - PAD - grow, y: box.y - PAD - grow, w: box.w + 2 * (PAD + grow), h: box.h + 2 * (PAD + grow) };

  // Label placement, kept inside the frame.
  const LW = Math.max(260, Math.min(620, Math.max(label.length, (note ?? "").length * 0.8) * 15 + 48));
  const gap = 18;
  let lx = r.x;
  let ly = r.y + r.h + gap;
  if (side === "top") ly = r.y - gap - (note ? 92 : 58);
  if (side === "left") { lx = r.x - gap - LW; ly = r.y; }
  if (side === "right") { lx = r.x + r.w + gap; ly = r.y; }
  lx = Math.max(24, Math.min(W - LW - 24, lx));
  ly = Math.max(24, Math.min(H - (note ? 92 : 58) - 24, ly));
  const slide = interpolate(enter, [0, 1], [side === "top" ? -12 : 12, 0]);

  return (
    <AbsoluteFill style={{ fontFamily }}>
      {background ? <Img src={background} style={{ width: W, height: H }} /> : null}
      {dim ? (
        <svg width={W} height={H} style={{ position: "absolute", inset: 0, opacity: o }}>
          <defs>
            <mask id="hole">
              <rect width={W} height={H} fill="white" />
              <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={14} fill="black" />
            </mask>
          </defs>
          <rect width={W} height={H} fill={T.dim} mask="url(#hole)" />
        </svg>
      ) : null}
      <div
        style={{
          position: "absolute",
          left: r.x,
          top: r.y,
          width: r.w,
          height: r.h,
          borderRadius: 14,
          border: `4px solid ${T.green}`,
          boxShadow: "0 0 0 6px rgba(20,161,85,0.25)",
          opacity: o,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: lx,
          top: ly + slide,
          maxWidth: LW,
          padding: "14px 20px",
          borderRadius: 10,
          background: T.text,
          color: T.white,
          opacity: o,
          boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ fontSize: 28, lineHeight: "34px", fontWeight: 600 }}>{label}</div>
        {note ? <div style={{ fontSize: 22, lineHeight: "30px", marginTop: 4, color: "#e4e4e7" }}>{note}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

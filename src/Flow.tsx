import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fontFamily, T, W } from "./theme";

export type FlowStep = { title: string; text: string };

export type FlowProps = {
  /** One plain sentence above the steps: what this picture explains. */
  heading: string;
  steps: FlowStep[];
  /** Frame each step appears on. Set from the narration's word timings so a step lands as it is said. */
  cues?: number[];
  /** Render every step fully drawn (for the still in the written guide). */
  still?: boolean;
};

/** A left-to-right sequence of steps that appear one at a time, joined by arrows. White, text first, no decoration. */
export const Flow: React.FC<FlowProps> = ({ heading, steps, cues, still }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const n = steps.length;
  const spread = Math.floor((durationInFrames - 40) / Math.max(1, n));
  const at = (i: number) => (cues && cues[i] !== undefined ? cues[i] : 16 + i * spread);
  const show = (i: number) => (still ? 1 : spring({ frame: frame - at(i), fps, config: { damping: 200 }, durationInFrames: 16 }));
  const headIn = still ? 1 : interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const out = still ? 1 : interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const margin = 120;
  const arrow = 72;
  const colW = (W - 2 * margin - (n - 1) * arrow) / n;
  // The step being described right now is black; earlier ones fade back so the eye follows the narration.
  const current = still ? -1 : steps.reduce((c, _, i) => (frame >= at(i) ? i : c), -1);

  return (
    <AbsoluteFill style={{ background: T.white, fontFamily, color: T.text, opacity: out }}>
      <div style={{ position: "absolute", left: margin, right: margin, top: 250, fontSize: 52, lineHeight: "64px", fontWeight: 600, opacity: headIn }}>
        {heading}
      </div>
      <div style={{ position: "absolute", left: margin, top: 470, display: "flex", alignItems: "flex-start" }}>
        {steps.map((s, i) => {
          const v = show(i);
          const faded = current > i ? 0.55 : 1;
          return (
            <div key={i} style={{ display: "flex", alignItems: "flex-start" }}>
              <div style={{ width: colW, opacity: v * faded, transform: `translateY(${interpolate(v, [0, 1], [18, 0])}px)` }}>
                <div style={{ fontSize: 26, lineHeight: "32px", color: T.green, fontWeight: 600 }}>{i + 1}</div>
                <div style={{ fontSize: 38, lineHeight: "46px", fontWeight: 600, marginTop: 8 }}>{s.title}</div>
                <div style={{ fontSize: 28, lineHeight: "40px", color: T.muted, marginTop: 12 }}>{s.text}</div>
              </div>
              {i < n - 1 ? (
                <svg width={arrow} height={60} style={{ marginTop: 60, opacity: show(i + 1) }}>
                  <line x1={14} y1={30} x2={interpolate(show(i + 1), [0, 1], [14, arrow - 16])} y2={30} stroke={T.line} strokeWidth={3} />
                  <path d={`M ${arrow - 26} 20 L ${arrow - 14} 30 L ${arrow - 26} 40`} fill="none" stroke={T.line} strokeWidth={3} />
                </svg>
              ) : null}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

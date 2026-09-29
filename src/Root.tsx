import { Composition } from "remotion";
import { Callout, type CalloutProps } from "./Callout";
import { Flow, type FlowProps } from "./Flow";
import { Still, type StillProps } from "./Still";
import { TitleCard, type TitleCardProps } from "./TitleCard";
import { FPS, H, W } from "./theme";

// Every composition takes its length from a `frames` prop, so render.mjs sets it from the narration it goes under.
type Timed = { frames?: number };
const len = ({ props }: { props: Timed }) => ({ durationInFrames: Math.max(1, Math.round(props.frames ?? 150)) });

export const Root: React.FC = () => (
  <>
    <Composition
      id="TitleCard"
      component={TitleCard as React.FC<TitleCardProps & Timed>}
      width={W}
      height={H}
      fps={FPS}
      durationInFrames={180}
      calculateMetadata={len}
      defaultProps={{ page: "Search", purpose: "Find anything in one place, in plain words.", chapters: ["How it works", "Search", "Read the results", "Act on it"], asOf: "As of Jan 1, 2027", frames: 180 }}
    />
    <Composition
      id="Callout"
      component={Callout as React.FC<CalloutProps & Timed>}
      width={W}
      height={H}
      fps={FPS}
      durationInFrames={120}
      calculateMetadata={len}
      defaultProps={{ box: { x: 600, y: 300, w: 700, h: 80 }, label: "The search box", side: "bottom", dim: true, frames: 120 }}
    />
    <Composition
      id="Flow"
      component={Flow as React.FC<FlowProps & Timed>}
      width={W}
      height={H}
      fps={FPS}
      durationInFrames={300}
      calculateMetadata={len}
      defaultProps={{ heading: "From a question to an answer", steps: [{ title: "Ask", text: "In plain words" }, { title: "Search", text: "Everything that could matter" }, { title: "Answer", text: "With sources" }], frames: 300 }}
    />
    <Composition
      id="Still"
      component={Still as React.FC<StillProps & Timed>}
      width={W}
      height={H}
      fps={FPS}
      durationInFrames={150}
      calculateMetadata={len}
      defaultProps={{ src: "logo.png", caption: "A still, framed", frames: 150 }}
    />
  </>
);

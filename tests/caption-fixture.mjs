// Two beats with a lead-in, a gap between takes, and nonzero aligned word offsets.
export function captionPlan(version = 1) {
  return { schema_version: 2, version, seconds: 12, music: true, beats: [
    { id: "a", start: 0, length: 6, vo_start: 0.5,
      narration: { say: "Open the guide.", seconds: 4, words: [
        { text: "Open", start: 1, end: 1.6 }, { text: "the", start: 1.7, end: 2 }, { text: "guide.", start: 2.1, end: 3 },
      ] }, publish: { overlays: [] } },
    { id: "b", start: 6, length: 6, vo_start: 6.5,
      narration: { say: "Choose English captions.", seconds: 4, words: [
        { text: "Choose", start: 0.5, end: 1.1 }, { text: "English", start: 1.2, end: 2 }, { text: "captions.", start: 2.1, end: 3.5 },
      ] }, publish: { overlays: [] } },
  ] };
}

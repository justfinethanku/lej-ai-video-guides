// Select a still from the metadata saved with the rendered cut, in video seconds.
// Legacy callers can pass an entry from graphics/manifest.json explicitly.
export function stillTime(beat, metadata = beat.publish) {
  const overlay = metadata.overlays?.[0];
  const offset = metadata.graphic ? Math.max(0, beat.length - 0.7)
    : overlay ? Math.min(overlay.start + 1.2, (overlay.start + overlay.end) / 2)
    : beat.length * 0.6;
  return beat.start + offset;
}

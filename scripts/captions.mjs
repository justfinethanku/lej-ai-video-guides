// Captions use only the alignment saved with this cut, never the current voice files.
const finite = value => typeof value === "number" && Number.isFinite(value);
const escape = text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function captionCues(plan) {
  const fail = message => { throw new Error(`Caption timing: ${message}. Rebuild the cut with aligned narration in a new version`); };
  if (!finite(plan?.seconds) || plan.seconds <= 0 || !Array.isArray(plan.beats) || !plan.beats.length) fail("missing final-cut duration or beats");
  const cues = [];
  let previousEnd = 0;
  for (const beat of plan.beats) {
    if (!beat || typeof beat !== "object") fail("invalid beat");
    const { start, length, vo_start: offset, narration } = beat;
    const bad = message => fail(`beat ${beat.id}: ${message}`);
    if (!finite(start) || !finite(length) || start < 0 || length <= 0 || start + length > plan.seconds + 0.001
        || !finite(offset) || offset < start || offset >= start + length) bad("missing or invalid vo_start/beat bounds");
    if (!narration || !finite(narration.seconds) || narration.seconds <= 0 || !Array.isArray(narration.words) || !narration.words.length) {
      bad("missing aligned narration (seconds, words)");
    }
    if (offset + narration.seconds > start + length + 1 / 30) bad("narration extends beyond the beat");
    let end = 0;
    const words = narration.words.map(word => {
      if (!word || typeof word.text !== "string" || !word.text.trim() || /[\r\n]/.test(word.text)
          || !finite(word.start) || !finite(word.end)) bad("missing or non-finite aligned word text/start/end");
      // Character alignment can contain zero-length words, tiny overlaps and take-tail overshoot.
      const begin = Math.min(Math.max(0, word.start, end), narration.seconds);
      end = Math.min(Math.max(word.end, begin + 0.001), narration.seconds);
      return { text: word.text.trim(), start: offset + begin, end: offset + end };
    }).filter(word => word.end > word.start);
    if (!words.length) continue;
    if (words[0].start < previousEnd) bad("narration overlaps the previous beat");
    let group = [];
    const flush = () => {
      if (!group.length) return;
      cues.push({ start: group[0].start, end: group.at(-1).end, text: group.map(w => w.text).join(" ") });
      group = [];
    };
    for (const word of words) {
      if (group.length && (group.map(w => w.text).join(" ").length + 1 + word.text.length > 42
          || word.end - group[0].start > 7 || word.start - group.at(-1).end > 1)) flush();
      group.push(word);
      if (/[.!?]["'”’)]*$/.test(word.text) && word.end - group[0].start >= 1) flush();
    }
    flush();
    previousEnd = words.at(-1).end;
  }
  return cues.map((cue, i) => ({ ...cue,
    // Hold brief phrases for a second where space permits, without covering the next cue.
    end: Math.min(Math.max(cue.end, cue.start + 1), cues[i + 1]?.start ?? plan.seconds),
  }));
}

function timestamp(seconds) {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

export function webVtt(plan) {
  return "WEBVTT\n\n" + captionCues(plan).map(cue => `${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${escape(cue.text)}\n\n`).join("");
}

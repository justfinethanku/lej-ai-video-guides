import assert from "node:assert/strict";
import { test } from "node:test";
import { atSeconds, calloutSpan, LEAD, TAIL } from "../scripts/timing.mjs";

const words = [
  { text: "Send,", start: 1 },
  { text: "follow-up", start: 2 },
  { text: "SEND!", start: 4 },
];

test("word cues preserve punctuation, repeated-word and numeric timing without machine config", () => {
  assert.equal(atSeconds("send", words), 1);
  assert.equal(atSeconds("Send#2", words), 4);
  assert.equal(atSeconds("followup", words), 2);
  assert.equal(atSeconds(0, words), 0);
  assert.equal(atSeconds(2.75, words), 2.75);
  assert.equal(atSeconds(null, words), null);
  assert.equal(atSeconds(undefined, words), null);
  assert.throws(() => atSeconds("send#3", words), /is not said/);
  assert.throws(() => atSeconds("missing", words), /is not said/);
  assert.equal(LEAD, 0.5);
  assert.equal(TAIL, 0.8);
});

test("callouts share cue timing, minimum duration and explicit zero end cues", () => {
  assert.deepEqual(calloutSpan({ at: "send", until: "send#2" }, words, 10), { start: 1.35, end: 4.45 });
  assert.deepEqual(calloutSpan({ at: 0 }, words, 10), { start: 0.35, end: 9.75 });
  assert.deepEqual(calloutSpan({ at: 0, until: 0 }, words, 10), { start: 0.35, end: 1.15 });
  assert.deepEqual(calloutSpan({ at: "send", until: null }, words, 10), { start: 1.35, end: 9.75 });
});

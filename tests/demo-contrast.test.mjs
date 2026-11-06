import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const html = readFileSync(new URL('../demo-app/index.html', import.meta.url), 'utf8');
const palette = Object.fromEntries([...html.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]));
function luminance(hex) {
  return [0.2126, 0.7152, 0.0722].reduce((sum, weight, i) => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return sum + weight * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  }, 0);
}
function contrast(a, b) {
  const [low, high] = [luminance(a), luminance(b)].sort((a, b) => a - b);
  return (high + 0.05) / (low + 0.05);
}
test('declared demo text and focus palettes meet their contrast thresholds', () => {
  // These are the backgrounds used by normal, hover, selected rows and reply cards.
  for (const fg of [palette.ink, palette.muted]) {
    for (const bg of ['#ffffff', palette.bg, palette['accent-soft']]) {
      assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg}: ${contrast(fg, bg)}`);
    }
  }
  assert.ok(contrast(palette.accent, '#ffffff') >= 4.5); // Primary button label, reversed pair.
  assert.ok(contrast(palette.accent, palette['accent-soft']) >= 4.5);
  assert.ok(contrast(palette.danger, '#fff1e8') >= 4.5);
  for (const bg of ['#ffffff', palette.bg, palette['accent-soft']]) assert.ok(contrast(palette.accent, bg) >= 3);
  const toastFocus = html.match(/\.toast button:focus-visible \{ outline-color:(#[\da-f]{6})/)[1];
  assert.ok(contrast(toastFocus, palette.ink) >= 3);
  const border = html.match(/\.search, \.compose textarea, select \{ border-color:(#[\da-f]{6})/)[1];
  assert.ok(contrast(border, '#ffffff') >= 3);
});

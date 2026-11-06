import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { transformSync } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import * as markdown from 'react-markdown';
import * as gfm from 'remark-gfm';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../site-example/page.tsx', import.meta.url), 'utf8');
const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic', target: 'es2022' }).code;
const guide = {
  slug: 'requests', title: 'Requests', summary: 'Work on requests', as_of: '2026-09-29',
  video: 'https://example.test/guide.mp4', poster: null, video_seconds: 50,
  body_md: '![Choose a priority](asset:choice.mp4)\n\n![Request list](asset:shot.png)\n\n![](asset:quiet.mp4)',
  assets: { 'choice.mp4': 'https://example.test/choice.mp4?token=synthetic', 'shot.png': 'https://example.test/shot.png', 'quiet.mp4': 'https://example.test/quiet.mp4' },
};
// Execute the real TSX with the real React/Markdown renderers. Stub only host-app
// auth and data: no Next app, DB credentials, signed URLs or service calls needed.
async function page(guides = [guide], userId = 'synthetic-user') {
  const module = { exports: {} };
  new Function('require', 'exports', 'module', compiled)(id => {
    if (id === './guides.css') return {};
    if (id === 'next/navigation') return { redirect: () => { throw new Error('redirect /login'); } };
    if (id === 'react-markdown') return { ...markdown, __esModule: true };
    if (id === 'remark-gfm') return { ...gfm, __esModule: true };
    if (id === '@/lib/auth') return { sessionUserId: async () => userId };
    if (id === '@/lib/guides') return {
      loadGuides: async () => guides, runningTime: () => '50 s', asOfLabel: () => 'Sep 29, 2026',
      assetUrl: (src, signed) => src.startsWith('asset:') ? signed[src.slice(6)] || '' : src,
      isVideo: src => /\.(mp4|webm|mov)$/i.test(src.split('?')[0]),
    };
    return require(id);
  }, module.exports, module);
  return new JSDOM(renderToStaticMarkup(await module.exports.default())).window.document;
}

test('guide videos and written-guide disclosures have distinct contextual names', async () => {
  const document = await page([guide, { ...guide, slug: 'customers', title: 'Customers' }]);
  assert.deepEqual([...document.querySelectorAll('.gd-video')].map(v => v.getAttribute('aria-label')), ['Requests video guide', 'Customers video guide']);
  assert.deepEqual([...document.querySelectorAll('summary')].map(s => s.textContent), ['Written guide: Requests', 'Written guide: Customers']);
  for (const video of document.querySelectorAll('video')) assert.equal(video.controls, true);
});
test('Markdown motion clips start paused with playback controls and a description', async () => {
  const document = await page();
  const clips = [...document.querySelectorAll('.gd-loop')];
  assert.equal(clips.length, 2);
  for (const clip of clips) {
    assert.equal(clip.autoplay, false); assert.equal(clip.controls, true);
    assert.equal(clip.preload, 'none'); assert.equal(clip.loop, true);
    assert.ok(clip.getAttribute('aria-label'));
  }
  assert.equal(clips[0].getAttribute('aria-label'), 'Choose a priority');
  assert.equal(clips[0].src, guide.assets['choice.mp4']);
  assert.equal(document.querySelector('.gd-shot').alt, 'Request list');
});
test('empty and signed-out states retain their original behavior', async () => {
  assert.match((await page([])).body.textContent, /No guides yet/);
  await assert.rejects(page([guide], null), /redirect \/login/);
});

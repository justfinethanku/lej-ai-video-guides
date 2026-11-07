import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { guide, pageElement } from './site-fixture.mjs';

async function page(...args) {
  return new JSDOM(renderToStaticMarkup(await pageElement(...args))).window.document;
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

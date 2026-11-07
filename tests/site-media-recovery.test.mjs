import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { guide, pageElement } from './site-fixture.mjs';

// Real React handlers and DOM. Media decoding/load and assistive technology are
// deliberately not simulated: dispatch the browser's media events explicitly.
async function fixture(t, guides = [guide], alreadyFailed = false) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/guides' });
  const saved = new Map();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLDetailsElement: dom.window.HTMLDetailsElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const loads = [];
  if (alreadyFailed) Object.defineProperty(dom.window.HTMLMediaElement.prototype, 'error', { get: () => ({ code: 2 }) });
  dom.window.HTMLMediaElement.prototype.load = function () { loads.push(this); };
  const root = createRoot(dom.window.document.getElementById('root'));
  const render = async data => { const element = await pageElement(data); await act(async () => root.render(element)); };
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  await render(guides);
  return {
    document: dom.window.document, loads, render,
    event: async (node, type) => act(async () => node.dispatchEvent(new dom.window.Event(type, { bubbles: false }))),
    click: async node => act(async () => node.click()),
  };
}

test('media failure, repeated retry and recovery announce state without moving focus or autoplay', async t => {
  const { document: d, event, click, loads } = await fixture(t);
  const video = d.querySelector('.gd-video');
  const status = d.getElementById(video.getAttribute('aria-describedby'));
  assert.ok(status, 'a live region exists before a media error');
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.getAttribute('aria-atomic'), 'true');
  assert.equal(status.textContent, '');
  await event(video, 'canplay');
  assert.equal(status.textContent, '', 'ordinary readiness is quiet');
  const focusBeforeFailure = d.querySelector('.gd-toc a');
  focusBeforeFailure.focus();
  await event(video, 'error');
  assert.match(status.textContent, /Requests video guide.*could not.*load/i);
  assert.ok(d.activeElement === focusBeforeFailure, "an asynchronous error does not steal focus");
  const retry = d.querySelector('.gd-media-actions button');
  assert.equal(retry.getAttribute('type'), 'button');
  assert.match(retry.textContent, /Retry.*Requests video guide/);
  retry.focus();
  await click(retry);
  assert.deepEqual(loads, [video]);
  assert.match(status.textContent, /Requests video guide.*retrying/i);
  assert.ok(d.activeElement === retry);
  await event(video, 'error');
  assert.match(status.textContent, /could not.*load/i);
  assert.ok(d.querySelector('.gd-media-actions button') === retry);
  await click(retry); await event(video, 'canplay');
  assert.equal(loads.length, 2);
  assert.match(status.textContent, /Requests video guide.*ready to play/i);
  assert.ok(d.activeElement === retry, 'successful recovery keeps the focused control mounted');
  assert.ok(d.querySelector('.gd-video') === video);
  assert.equal(video.autoplay, false);
  assert.equal(video.controls, true);
});

test('failed narration offers the matching written guide and focuses its opened disclosure', async t => {
  const { document: d, event, click } = await fixture(t, [guide, { ...guide, slug: 'customers', title: 'Customers' }]);
  const sections = d.querySelectorAll('.gd-guide');
  await event(sections[1].querySelector('video'), 'error');
  const link = sections[1].querySelector('.gd-media-actions a');
  assert.ok(link, 'a written fallback is available');
  assert.match(link.textContent, /Customers/);
  await click(link);
  const details = sections[1].querySelector('details');
  assert.equal(details.open, true);
  assert.ok(d.activeElement === details.querySelector('summary'));
  assert.equal(sections[0].querySelector('details').open, false);
});

test('missing written content has no dead fallback; motion clips recover independently', async t => {
  const { document: d, event } = await fixture(t, [guide, { ...guide, slug: 'video-only', title: 'Video only', body_md: '' }]);
  const videos = d.querySelectorAll('video');
  const ids = [...videos].map(v => v.getAttribute('aria-describedby'));
  assert.equal(new Set(ids).size, videos.length, 'every player owns a distinct status');
  assert.ok(ids.every(id => id && d.getElementById(id)));
  const clip = d.querySelector('.gd-loop');
  await event(clip, 'error');
  const clipStatus = d.getElementById(clip.getAttribute('aria-describedby'));
  assert.match(clipStatus.textContent, /Choose a priority.*could not.*load/i);
  assert.equal(clip.muted, true); assert.equal(clip.loop, true); assert.equal(clip.preload, 'none');
  const last = d.querySelector('#video-only');
  await event(last.querySelector('video'), 'error');
  assert.equal(last.querySelector('.gd-media-actions a'), null);
  assert.equal(d.getElementById(videos[0].getAttribute('aria-describedby')).textContent, '');
  assert.match(clipStatus.textContent, /could not.*load/i);
});

for (const replacement of [{ video: 'https://example.test/new-cut.mp4' }, { captions: 'https://example.test/renewed.vtt' }])
test(`replacement ${Object.keys(replacement)[0]} clears old failure and ignores detached-player events`, async t => {
  const { document: d, event, render } = await fixture(t);
  const old = d.querySelector('.gd-video');
  await event(old, 'error');
  const status = d.getElementById(old.getAttribute('aria-describedby'));
  assert.ok(status?.textContent.includes('could not'), 'original failure is visible');
  await render([{ ...guide, ...replacement }]);
  const current = d.querySelector('.gd-video');
  assert.ok(current !== old);
  const currentStatus = d.getElementById(current.getAttribute('aria-describedby'));
  assert.equal(currentStatus.textContent, '');
  await event(old, 'error');
  assert.equal(currentStatus.textContent, '');
  assert.equal(d.querySelector('.gd-media-actions'), null);
});

test('media errors already present when handlers mount are reported; a rejected reload retains recovery', async t => {
  const { document: d, click } = await fixture(t, [guide], true);
  const video = d.querySelector('.gd-video');
  const status = d.getElementById(video.getAttribute('aria-describedby'));
  assert.match(status?.textContent || '', /could not.*load/i);
  video.load = () => { throw new Error('synthetic media reload rejection'); };
  const retry = d.querySelector('.gd-media-actions button');
  retry.focus(); await click(retry);
  assert.match(status.textContent, /could not.*load/i);
  assert.ok(d.activeElement === retry);
});

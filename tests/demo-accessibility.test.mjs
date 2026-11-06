import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import axe from 'axe-core';
const html = readFileSync(new URL('../demo-app/index.html', import.meta.url), 'utf8');
function demo(t) {
  const intervals = new Map(), errors = [];
  let nextTimer = 0;
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html, {
    url: 'https://relaydesk.example/#/requests', runScripts: 'dangerously', virtualConsole: console,
    beforeParse(window) {
      window.setInterval = fn => { intervals.set(++nextTimer, fn); return nextTimer; };
      window.clearInterval = id => intervals.delete(id);
      // jsdom has no native modal behavior. Test the app's show/close contract;
      // background inertness, Escape and native Tab containment need a browser.
      window.HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute('open', ''); this.dataset.modalCalled = 'true';
        this.querySelector('[autofocus]')?.focus();
      };
      window.HTMLDialogElement.prototype.close = function () {
        this.removeAttribute('open'); this.dispatchEvent(new window.Event('close'));
      };
    },
  });
  t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
  const document = dom.window.document;
  const get = selector => { const el = document.querySelector(selector); assert.ok(el, `missing ${selector}`); return el; };
  const click = selector => get(selector).click();
  const input = (selector, value) => { const el = get(selector); el.value = value; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  const key = (selector, value) => get(selector).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  const tick = () => { for (const fn of [...intervals.values()]) fn(); };
  return { window: dom.window, document, get, click, input, key, tick };
}
test('request actions are native buttons and opening/closing preserves a useful focus target', t => {
  const { get, click, document } = demo(t);
  const opener = get('tr[data-id="r3"] .subj button');
  assert.equal(opener.tagName, 'BUTTON'); // Enter/Space activation supplied by browser.
  opener.click();
  assert.equal(document.activeElement.id, 'request-title');
  assert.match(document.activeElement.textContent, /Charged twice/);
  assert.equal(get('#panel').getAttribute('aria-labelledby'), 'request-title');
  click('#close-panel'); assert.equal(document.activeElement.id, 'request-r3');
});
test('status tabs expose selection and support wrapping arrows, Home and End without losing focus', t => {
  const { get, key, document } = demo(t);
  get('[data-tab="open"]').focus(); key('[data-tab="open"]', 'ArrowLeft');
  assert.equal(get('[aria-selected="true"]').dataset.tab, 'done');
  assert.equal(document.activeElement.id, 'tab-done');
  assert.equal(get('[data-tab="open"]').tabIndex, -1);
  assert.equal(get('#request-results').getAttribute('aria-labelledby'), 'tab-done');
  key('#tab-done', 'Home'); assert.equal(get('[aria-selected="true"]').dataset.tab, 'open');
  key('#tab-open', 'End'); key('#tab-done', 'ArrowRight');
  assert.equal(document.activeElement.id, 'tab-open');
});
test('filter disclosure state, Escape, selecting and clearing retain keyboard context', t => {
  const { get, click, key, input, document } = demo(t);
  click('#pri'); assert.equal(get('#pri').getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement.dataset.p, 'any');
  key('[data-p="any"]', 'Escape');
  assert.equal(get('#pri').getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement.id, 'pri');
  click('#pri'); click('[data-p="Urgent"]');
  assert.equal(document.querySelectorAll('tr[data-id]').length, 3);
  assert.equal(document.activeElement.id, 'pri');
  input('#q', 'Bluebird'); assert.equal(document.querySelectorAll('tr[data-id]').length, 1);
  assert.equal(document.activeElement.id, 'q');
  assert.match(get('[role="status"]').textContent, /1 requests found/);
  click('#clear'); assert.equal(document.activeElement.id, 'q');
  assert.equal(document.querySelectorAll('tr[data-id]').length, 6);
});
test('assignment rerender keeps focus and typed reply; search retains selection', t => {
  const { get, click, input, document, window } = demo(t);
  click('tr[data-id="r3"] .subj'); input('#reply', 'A draft worth keeping');
  const assign = get('#assign'); assign.focus(); assign.value = 'Priya Shah';
  assign.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(document.activeElement.id, 'assign');
  assert.equal(get('#reply').value, 'A draft worth keeping');
  click('#close-panel'); click('tr[data-id="r3"] .subj');
  assert.equal(get('#reply').value, 'A draft worth keeping');
  const q = get('#q'); q.value = 'Bluebird'; q.setSelectionRange(1, 5);
  q.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(document.activeElement.id, 'q');
  assert.equal(get('#q').selectionStart, 1); assert.equal(get('#q').selectionEnd, 5);
});
test('Undo survives countdown ticks and remains focused; cancelling preserves draft', t => {
  const { get, click, input, tick, document } = demo(t);
  click('tr[data-id="r3"] .subj'); input('#reply', 'My reply'); click('#send');
  const undo = get('#undo'); undo.focus(); tick(); tick();
  assert.equal(get('#undo'), undo); assert.equal(document.activeElement, undo);
  assert.equal(get('#send').disabled, true); assert.equal(get('#close-request').disabled, true);
  click('#undo'); assert.equal(document.activeElement.id, 'reply');
  assert.equal(get('#reply').value, 'My reply'); tick(); tick(); tick();
  assert.equal(get('tr[data-id="r3"] .subj button').getAttribute('aria-expanded'), 'true');
  assert.match(get('[role="status"]').textContent, /Nothing was sent/);
});
test('completed send restores focus after removing Undo and announces new state', t => {
  const { get, click, input, tick, document } = demo(t);
  click('tr[data-id="r3"] .subj'); input('#reply', 'My reply'); click('#send');
  for (let i = 0; i < 5; i++) tick();
  assert.equal(document.querySelector('#undo'), null);
  assert.equal(document.activeElement.id, 'assign'); assert.equal(get('#reply').value, '');
  assert.match(get('[role="status"]').textContent, /Reply sent/);
  assert.match(get('.msg.mine').textContent, /My reply/);
  click('#close-panel'); assert.equal(document.activeElement.id, 'tab-open');
  click('#tab-waiting'); assert.ok(get('tr[data-id="r3"]'));
});
test('confirmation uses named native modal, starts on Cancel and restores focus', t => {
  const { get, click, document } = demo(t);
  click('tr[data-id="r3"] .subj'); click('#close-request');
  const dialog = get('dialog[open]'); assert.equal(dialog.dataset.modalCalled, 'true');
  assert.match(get(`#${dialog.getAttribute('aria-labelledby')}`).textContent, /Close this request/);
  assert.match(get(`#${dialog.getAttribute('aria-describedby')}`).textContent, /can't be reopened/);
  assert.equal(document.activeElement.id, 'cancel');
  click('#cancel'); assert.equal(document.activeElement.id, 'close-request');
  assert.equal(document.querySelector('dialog'), null);
  click('#close-request'); click('#confirm');
  assert.equal(document.activeElement.id, 'tab-open'); assert.equal(document.querySelector('#panel'), null);
  click('#tab-done'); assert.ok(get('tr[data-id="r3"]'));
});
test('form controls have explicit names and overdue has a text equivalent', t => {
  const { get, click } = demo(t);
  assert.match(get('#q').labels[0].textContent, /Search customer or subject/);
  assert.equal(get('#nav-requests').getAttribute('aria-current'), 'page');
  assert.match(get('.age.late').textContent, /overdue/);
  click('tr[data-id="r3"] .subj');
  assert.match(get('#assign').labels[0].textContent, /Assigned to/);
  assert.match(get('#reply').labels[0].textContent, /Reply to/);
});
test('axe finds no DOM-checkable WCAG A/AA violations on list, panel, priority choices or modal', async t => {
  const { window, click } = demo(t); window.eval(axe.source);
  for (const transition of [() => {}, () => click('tr[data-id="r3"] .subj'), () => click('#pri'), () => { click('#pri'); click('#close-request'); }]) {
    transition();
    const result = await window.axe.run(window.document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false } }, // jsdom has no layout; palette checked separately.
    });
    assert.equal(result.violations.length, 0, JSON.stringify(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))));
  }
});

test('route navigation updates current-page state and background send completion has a focus fallback', async t => {
  const { get, click, input, window, document, tick } = demo(t);
  click('tr[data-id="r3"] .subj'); input('#reply', 'A reply'); click('#send');
  window.location.hash = '#/customers';
  await new Promise(resolve => window.setTimeout(resolve, 0));
  assert.equal(get('#nav-customers').getAttribute('aria-current'), 'page');
  assert.equal(get('#nav-requests').hasAttribute('aria-current'), false);
  assert.equal(document.activeElement.id, 'page-title');
  get('#undo').focus();
  for (let i = 0; i < 5; i++) tick();
  assert.equal(document.activeElement.id, 'page-title');
  assert.match(document.activeElement.textContent, /Customers/);
});

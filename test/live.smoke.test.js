/* Live smoke test: play a real game against the deployed Render URL. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const URL = 'https://future-hide-and-seek.onrender.com/';

test('live site loads and a full game plays end to end', async () => {
  const dom = await JSDOM.fromURL(URL, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.__FHS_DISABLE_MUSIC__ = true;
      window.AudioContext = class {
        constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
        resume() {}
        createGain() { return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
        createOscillator() { return { type: '', frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
      };
    }
  });
  const window = dom.window;
  const doc = window.document;
  const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const screen = () => Array.from(doc.querySelectorAll('.screen.active')).map(s => s.id)[0];

  // wait for scripts to boot
  await new Promise(r => setTimeout(r, 300));
  assert.ok(window.FHSUI, 'game booted on the live site');
  assert.strictEqual(screen(), 'screen-menu', 'menu shows first');

  // start setup, 2 players, beginner
  click(doc.getElementById('btn-menu-start'));
  assert.strictEqual(screen(), 'screen-setup');
  window.FHSUI.setSetup(2, 'beginner', [
    { name: 'Live', avatarId: 'explorer', color: '#ffb648' },
    { name: 'Test', avatarId: 'robot', color: '#3dffa0' }
  ]);
  click(doc.getElementById('btn-setup-start'));
  if (screen() === 'screen-tutorial') click(doc.getElementById('btn-tut-skip'));
  assert.strictEqual(screen(), 'screen-hide', 'hide screen reached');

  // hider picks first active spot
  const map = doc.getElementById('map-hide');
  const spot = map.querySelector('.spot:not(.inactive)').getAttribute('data-spot');
  click(map.querySelector('.spot[data-spot="' + spot + '"]'));
  click(doc.querySelector('[data-action="confirm-hide"]'));
  assert.strictEqual(screen(), 'screen-privacy', 'privacy pass shown');

  // seeker phase
  click(doc.getElementById('btn-privacy-ready'));
  assert.strictEqual(screen(), 'screen-seek', 'seeker screen reached');
  const g = window.FHSUI.game;
  assert.ok(g.getSeekerSearchState().guessesTotal === 4, 'beginner 4 guesses on live site');

  // search until the round resolves
  let guard = 0;
  while (screen() === 'screen-seek' && guard < 30) {
    const seekMap = doc.getElementById('map-seek');
    const s = seekMap.querySelector('.spot:not(.inactive)');
    click(s);
    const confirm = doc.querySelector('[data-action="do-search"]');
    const text = doc.getElementById('modal-card').textContent;
    if (text.indexOf('Just a hologram') !== -1 || text.indexOf('Not a hiding place') !== -1) {
      click(doc.querySelector('[data-action="close-modal"]'));
    } else if (confirm) {
      click(confirm);
      const t2 = doc.getElementById('modal-card').textContent;
      if (t2.indexOf('Found You!') !== -1 || t2.indexOf('escaped this round') !== -1) {
        click(doc.querySelector('[data-action="continue-after-result"]'));
      } else {
        click(doc.querySelector('[data-action="close-modal"]'));
      }
    }
    guard++;
  }
  assert.strictEqual(screen(), 'screen-round-results', 'round completed on live site');
  console.log('LIVE OK — game plays end to end at', URL);
  dom.window.close();
});

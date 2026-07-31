/* ============================================================================
 * Future Hide & Seek — full UI smoke test (plays the game through jsdom DOM)
 * Runs with:  node --test test/ui.smoke.test.js
 * Simulates a real 3-player game end-to-end: menu → setup → tutorial → hide
 * turns → privacy → seek turns → round results → champion → play again.
 * ========================================================================== */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

function buildPage() {
  let html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const core = fs.readFileSync(path.join(ROOT, 'public', 'js', 'game-core.js'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'public', 'js', 'ui.js'), 'utf8');
  // Strip the external CSS (fonts) — not needed for logic
  html = html.replace(/<link[^>]*>/g, '');
  // Inline the two scripts so jsdom does not need network / file:// loading
  html = html.replace('<script src="js/game-core.js"></script>', '<script>' + core + '</' + 'script>');
  html = html.replace('<script src="js/ui.js"></script>', '<script>' + ui + '</' + 'script>');
  return html;
}

function makeDom() {
  const errors = [];
  const dom = new JSDOM(buildPage(), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.__FHS_DISABLE_MUSIC__ = true;   // no background-music intervals in tests
      // stub AudioContext entirely — audio must never break logic
      window.AudioContext = class {
        constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
        resume() {}
        createGain() { return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
        createOscillator() { return { type: '', frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
      };
    }
  });
  const window = dom.window;
  window.addEventListener('error', e => errors.push(e.error ? e.error.message : String(e.message)));
  return { dom, window, errors };
}

/* ---- interaction helpers (all in the jsdom window) ---- */
function click(window, el) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}
function clickSpot(window, container, spotId) {
  const el = container.querySelector('.spot[data-spot="' + spotId + '"]');
  assert.ok(el, 'spot exists: ' + spotId);
  click(window, el); // dispatch on the <g>; handler uses closest()
}
function activeSpots(container) {
  return Array.from(container.querySelectorAll('.spot:not(.inactive)')).map(e => e.getAttribute('data-spot'));
}
function modalText(window) {
  return window.document.getElementById('modal-card').textContent;
}
function clickModalAction(window, action) {
  const btn = window.document.querySelector('[data-action="' + action + '"]');
  assert.ok(btn, 'modal action button exists: ' + action);
  click(window, btn);
}
function screenIs(window, id) {
  return window.document.getElementById(id).classList.contains('active');
}

/* Hide every hider by clicking distinct active spots and confirming.
 * Stops as soon as the screen is no longer the hide screen (privacy pass).
 * Does NOT click the final "Ready" — the caller decides when to hand over. */
function playHidingPhase(window, usedSpots) {
  const map = window.document.getElementById('map-hide');
  for (let guard = 0; guard < 12; guard++) {
    if (!screenIs(window, 'screen-hide')) break;
    const spots = activeSpots(map).filter(s => usedSpots.indexOf(s) === -1);
    assert.ok(spots.length > 0, 'an unused active spot exists');
    const pick = spots[0];
    usedSpots.push(pick);
    clickSpot(window, map, pick);
    clickModalAction(window, 'confirm-hide');
  }
}

/* Full hiding cycle for any player count: hide every hider, click every
 * privacy "Ready", and stop once the Seeker screen appears. */
function completeHidingPhase(window, usedSpots) {
  const map = window.document.getElementById('map-hide');
  for (let guard = 0; guard < 16; guard++) {
    if (screenIs(window, 'screen-hide')) {
      const spots = activeSpots(map).filter(s => usedSpots.indexOf(s) === -1);
      assert.ok(spots.length > 0, 'an unused active spot exists');
      const pick = spots[0];
      usedSpots.push(pick);
      clickSpot(window, map, pick);
      clickModalAction(window, 'confirm-hide');
    } else if (screenIs(window, 'screen-privacy')) {
      click(window, window.document.getElementById('btn-privacy-ready'));
    } else {
      break;
    }
  }
}

/* Seeker clicks spots until the current target resolves. Returns 'found' | 'escaped'. */
function playSearchPhase(window, tries) {
  const map = window.document.getElementById('map-seek');
  const clicked = [];
  for (let i = 0; i < (tries || 60); i++) {
    if (!screenIs(window, 'screen-seek')) break;
    const spots = activeSpots(map).filter(s => clicked.indexOf(s) === -1);
    const pick = spots[i % spots.length];
    clicked.push(pick);
    clickSpot(window, map, pick);
    const text = modalText(window);
    if (text.indexOf('Just a hologram') !== -1) { clickModalAction(window, 'close-modal'); continue; }
    if (text.indexOf('Not a hiding place') !== -1) { clickModalAction(window, 'close-modal'); continue; }
    // either "Search here?" confirm or a result
    const confirmBtn = window.document.querySelector('[data-action="do-search"]');
    if (confirmBtn) click(window, confirmBtn);
    const text2 = modalText(window);
    if (text2.indexOf('Found You!') !== -1) {
      clickModalAction(window, 'continue-after-result');
      return 'found';
    }
    if (text2.indexOf('escaped this round') !== -1) {
      clickModalAction(window, 'continue-after-result');
      return 'escaped';
    }
    if (text2.indexOf('Nobody is hiding here!') !== -1) {
      clickModalAction(window, 'close-modal');
    }
  }
  throw new Error('search phase did not resolve');
}

/* ------------------------------------------------------------------ */
test('full 3-player game end to end via the DOM', () => {
  const { window, errors } = makeDom();
  const doc = window.document;
  const UI = window.FHSUI;

  assert.ok(UI, 'ui.js booted and exposed FHSUI');
  assert.strictEqual(screenIs(window, 'screen-menu'), true, 'menu is the first screen');

  // ---- menu → setup ----
  click(window, doc.getElementById('btn-menu-start'));
  assert.strictEqual(screenIs(window, 'screen-setup'), true, 'setup screen shown');
  assert.strictEqual(doc.querySelectorAll('.player-card').length, 2, 'default 2 players');

  // ---- configure 3 players ----
  UI.setSetup(3, 'intermediate', [
    { name: 'Ali', avatarId: 'explorer', color: '#ffb648' },
    { name: 'Bella', avatarId: 'robot', color: '#3dffa0' },
    { name: 'Cody', avatarId: 'ninja', color: '#c77dff' }
  ]);
  assert.strictEqual(doc.querySelectorAll('.player-card').length, 3, '3 player cards');

  click(window, doc.getElementById('btn-setup-start'));

  // ---- tutorial (first time) ----
  assert.strictEqual(screenIs(window, 'screen-tutorial'), true, 'tutorial shown on first game');
  for (let i = 0; i < 5; i++) click(window, doc.getElementById('btn-tut-next'));
  assert.strictEqual(doc.getElementById('btn-tut-next').textContent, 'Start Game ▶');
  click(window, doc.getElementById('btn-tut-next'));

  // ---- round 1: hiding ----
  assert.strictEqual(screenIs(window, 'screen-hide'), true, 'hide screen shown');
  const game1 = UI.game;
  assert.ok(game1, 'core game created');
  assert.strictEqual(game1.getState().players.length, 3);
  const usedSpots = [];
  completeHidingPhase(window, usedSpots);
  assert.strictEqual(screenIs(window, 'screen-seek'), true, 'seeker screen reached after all hiders');

  // ---- round 1: seeking ----
  const st = game1.getSeekerSearchState();
  assert.ok(st.guessesLeft > 0, 'seeker has guesses');
  assert.ok(doc.querySelector('#topbar-seek .tb-chip.guesses'), 'top bar shows guesses');
  playSearchPhase(window);
  // second target
  if (screenIs(window, 'screen-seek')) playSearchPhase(window);

  // ---- round 1 results ----
  assert.strictEqual(screenIs(window, 'screen-round-results'), true, 'round results shown');
  assert.ok(doc.getElementById('results-body').textContent.indexOf('Leaderboard') !== -1, 'leaderboard rendered');
  assert.ok(game1.getState().players.some(p => p.score > 0), 'some score was earned');

  // ---- rounds 2 and 3 ----
  for (let r = 2; r <= 3; r++) {
    click(window, doc.getElementById('btn-next-round'));
    assert.strictEqual(screenIs(window, 'screen-hide'), true, 'round ' + r + ' hide phase');
    const g = UI.game;
    assert.strictEqual(g.getState().round, r, 'round counter advanced');
    completeHidingPhase(window, []);
    // with 3 players, the seeker searches 2 hiders
    let guard = 0;
    while (screenIs(window, 'screen-seek') && guard < 4) { playSearchPhase(window); guard++; }
    assert.strictEqual(screenIs(window, 'screen-round-results'), true, 'round ' + r + ' results');
  }

  // ---- champion ----
  click(window, doc.getElementById('btn-next-round'));
  assert.strictEqual(screenIs(window, 'screen-champion'), true, 'champion screen shown');
  const winner = UI.game.getWinner();
  assert.ok(winner, 'winner exists');
  assert.ok(doc.getElementById('champ-name').textContent.indexOf(winner.name) !== -1, 'winner name displayed');

  // ---- play again resets ----
  click(window, doc.getElementById('btn-play-again'));
  assert.strictEqual(screenIs(window, 'screen-hide'), true, 'play again starts a new game');
  assert.ok(UI.game.getState().players.every(p => p.score === 0), 'scores reset on play again');

  // ---- main menu ----
  click(window, doc.getElementById('btn-main-menu'));
  assert.strictEqual(screenIs(window, 'screen-menu'), true, 'main menu reachable');

  // champion was saved locally
  const champs = JSON.parse(window.localStorage.getItem('fhs_champs') || '[]');
  assert.ok(champs.length >= 1, 'champion saved to localStorage');

  assert.deepStrictEqual(errors, [], 'no uncaught JS errors during the whole game');
});

test('beginner difficulty runs a full 2-player game with no errors', () => {
  const { window, errors } = makeDom();
  const doc = window.document;
  const UI = window.FHSUI;

  click(window, doc.getElementById('btn-menu-start'));
  UI.setSetup(2, 'beginner', [
    { name: 'Zoe', avatarId: 'alien', color: '#7bed9f' },
    { name: 'Max', avatarId: 'racer', color: '#ff7f50' }
  ]);
  click(window, doc.getElementById('btn-setup-start'));
  // skip tutorial this time
  click(window, doc.getElementById('btn-tut-skip'));
  assert.strictEqual(screenIs(window, 'screen-hide'), true);

  playHidingPhase(window, []);
  click(window, doc.getElementById('btn-privacy-ready'));
  assert.strictEqual(screenIs(window, 'screen-seek'), true);
  const st = UI.game.getSeekerSearchState();
  assert.strictEqual(st.guessesTotal, 4, 'beginner has 4 guesses');
  assert.ok(st.autoClue, 'beginner shows an auto clue');
  assert.ok(doc.getElementById('seek-banner').textContent.indexOf('Clue') !== -1, 'clue shown in banner');
  playSearchPhase(window);
  if (screenIs(window, 'screen-seek')) playSearchPhase(window);
  assert.strictEqual(screenIs(window, 'screen-round-results'), true);
  click(window, doc.getElementById('btn-next-round'));
  assert.strictEqual(screenIs(window, 'screen-hide'), true, 'round 2 begins');
  playHidingPhase(window, []);
  click(window, doc.getElementById('btn-privacy-ready'));
  let guard = 0;
  while (screenIs(window, 'screen-seek') && guard < 4) { playSearchPhase(window); guard++; }
  click(window, doc.getElementById('btn-next-round'));
  assert.strictEqual(screenIs(window, 'screen-champion'), true, 'champion after 2 rounds');
  assert.deepStrictEqual(errors, [], 'no uncaught JS errors (beginner)');
});

test('hider power-up flow works through the confirm modal', () => {
  const { window } = makeDom();
  const doc = window.document;
  const UI = window.FHSUI;

  click(window, doc.getElementById('btn-menu-start'));
  UI.setSetup(2, 'intermediate', [
    { name: 'Ann', avatarId: 'scientist', color: '#4cc9f0' },
    { name: 'Bob', avatarId: 'detective', color: '#8aa2ff' }
  ]);
  click(window, doc.getElementById('btn-setup-start'));
  click(window, doc.getElementById('btn-tut-skip'));

  const map = doc.getElementById('map-hide');
  const spots = activeSpots(map);
  // The hider may or may not have a power-up; if the confirm modal offers one,
  // try using it (toggle) then confirm.
  clickSpot(window, map, spots[0]);
  const toggle = doc.querySelector('[data-action="toggle-hider-power"]');
  if (toggle) {
    click(window, toggle);
    const usedNow = doc.querySelector('[data-action="toggle-hider-power"] b').textContent;
    assert.ok(usedNow.indexOf('✓ Using') !== -1, 'power-up toggle shows as using');
  }
  clickModalAction(window, 'confirm-hide');
  assert.strictEqual(screenIs(window, 'screen-privacy'), true, 'hider confirmed & passed on');
  click(window, doc.getElementById('btn-privacy-ready'));
  assert.strictEqual(screenIs(window, 'screen-seek'), true, 'seeker phase started');
});

test('spot click on the map updates pending selection styling', () => {
  const { window } = makeDom();
  const doc = window.document;
  const UI = window.FHSUI;

  click(window, doc.getElementById('btn-menu-start'));
  UI.setSetup(2, 'intermediate', [
    { name: 'X', avatarId: 'explorer', color: '#ffb648' },
    { name: 'Y', avatarId: 'robot', color: '#3dffa0' }
  ]);
  click(window, doc.getElementById('btn-setup-start'));
  click(window, doc.getElementById('btn-tut-skip'));

  const map = doc.getElementById('map-hide');
  const spots = activeSpots(map);
  clickSpot(window, map, spots[0]);
  // confirm modal contains the spot name
  assert.ok(modalText(window).indexOf('Hide here?') !== -1, 'confirm modal shown');
  clickModalAction(window, 'cancel-hide');
  assert.ok(modalText(window).length === 0 || !doc.getElementById('modal-root').hidden === false, 'modal closed');
});

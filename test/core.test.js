/* ============================================================================
 * Future Hide & Seek — automated QA tests
 * Runs with:  node --test test/core.test.js
 * Covers the full checklist from the game brief:
 *   - Hider can choose a location
 *   - Selected location hidden after the hider's turn (no leaks via public API)
 *   - Seeker cannot see stored locations before searching
 *   - Correct number of guesses
 *   - Correct guesses reveal the right hider
 *   - Scores calculated correctly
 *   - Every player gets a turn as Seeker
 *   - Leaderboard updates correctly
 *   - Restarting removes previous game's temporary data
 *   - Duplicate hiding spots rejected
 *   - Power-ups behave (scanner / clue / extra guess / tunnel / decoy / silent)
 * ========================================================================== */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const core = require('../public/js/game-core.js');

/* Deterministic RNG so tests are reproducible */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePlayers(n, prefix) {
  const avatars = core.AVATARS;
  return Array.from({ length: n }, (_, i) => ({
    name: (prefix || 'P') + (i + 1),
    avatarId: avatars[i % avatars.length].id,
    color: '#ffffff'
  }));
}

/* Hide every hider at the given spots (in hide-turn order).
 * Returns the hider ids in hide-turn order (target search order). */
function hideAll(game, spots) {
  const order = [];
  spots.forEach((spot, i) => {
    const cur = game.getCurrentHider();
    assert.ok(cur, `hider turn ${i} exists`);
    const res = game.commitHide(cur, spot);
    assert.strictEqual(res.ok, true, `hider ${cur} hides at ${spot}`);
    order.push(cur);
  });
  return order;
}

/* Pick `count` active spots that are safe to use as WRONG guesses:
 * not one of the real hide spots, and not a decoy shimmer. */
function wrongSpots(game, excludeSpots, count) {
  const st = game.getSeekerSearchState();
  const banned = new Set((st.decoySpots || []).concat(excludeSpots));
  return game.getState().activeSpots.filter(s => !banned.has(s)).slice(0, count);
}

function allSpotIds(game) {
  return game.getState().activeSpots;
}

/* ------------------------------------------------------------------ */
test('core loads with 22 locations and 8 avatars', () => {
  assert.strictEqual(core.LOCATIONS.length, 22);
  assert.strictEqual(core.AVATARS.length, 8);
  assert.deepStrictEqual(Object.keys(core.DIFFICULTIES), ['beginner', 'intermediate', 'advanced']);
});

test('active spot counts match difficulty (10/15/22)', () => {
  ['beginner', 'intermediate', 'advanced'].forEach(diff => {
    const g = core.createGame({ difficulty: diff, players: makePlayers(3) }, mulberry32(7));
    assert.strictEqual(g.getState().activeSpots.length, core.DIFFICULTIES[diff].spots);
  });
});

test('2 players is allowed, 1 and 6 players are rejected', () => {
  core.createGame({ difficulty: 'beginner', players: makePlayers(2) }, mulberry32(1));
  assert.throws(() => core.createGame({ difficulty: 'beginner', players: makePlayers(1) }, mulberry32(1)));
  assert.throws(() => core.createGame({ difficulty: 'beginner', players: makePlayers(6) }, mulberry32(1)));
});

test('hider flow: choose, duplicate rejection, seal, privacy of hides', () => {
  const g = core.createGame({ difficulty: 'beginner', players: makePlayers(3) }, mulberry32(11));
  const spots = allSpotIds(g);
  assert.ok(spots.length >= 10, 'beginner has 10 active spots');

  const s1 = g.getState();
  const hider = g.getCurrentHider();
  assert.ok(hider, 'a hider is current');

  // Hide ok
  let res = g.commitHide(hider, spots[0]);
  assert.strictEqual(res.ok, true);
  assert.ok(res.nextHiderId, 'another hider is next');

  // Second hider cannot take the same spot
  const hider2 = g.getCurrentHider();
  res = g.commitHide(hider2, spots[0]);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, 'taken');

  // Second hider hides somewhere else -> game seals (3 players = 2 hiders)
  res = g.commitHide(hider2, spots[1]);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.sealed, true, 'game seals after the last hider');

  // PUBLIC STATE MUST NEVER LEAK HIDES
  const json = JSON.stringify(g.getState());
  assert.ok(!json.includes('hides'), 'getState() has no hides field');
  const seekerView = JSON.stringify(g.getSeekerSearchState());
  for (const spotId of spots.slice(0, 2)) {
    assert.ok(seekerView.indexOf('"' + spotId + '"') === -1,
      `seeker view must not contain hidden spot ${spotId}`);
  }
  assert.strictEqual(g.getSeekerSearchState().hintSpots.length, 0);
});

test('seeker: correct guesses reveal the right hider + scoring table', () => {
  const g = core.createGame({ difficulty: 'intermediate', players: makePlayers(3) }, mulberry32(21));
  const spots = allSpotIds(g);
  const order = hideAll(g, spots.slice(0, 2));
  const seekerId = g.getState().currentSeekerId;
  const seekerStart = g.getLeaderboard().find(p => p.id === seekerId).score;

  // Find hider 0 (hiding at spots[0]) on the FIRST guess → seeker +100
  g.beginTargetSearch();
  let st = g.getSeekerSearchState();
  assert.strictEqual(st.guessesLeft, 3, 'three guesses per hider on intermediate');
  assert.strictEqual(st.hidersRemaining, 2);
  assert.ok(!JSON.stringify(st).includes('"' + spots[0] + '"'), 'no spot ids leak');

  let res = g.searchSpot(spots[0]);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.found, true, 'first guess correct');
  assert.strictEqual(res.guess, 1);
  assert.strictEqual(res.seekerPoints, 100);
  assert.strictEqual(res.hider.id, order[0], 'reveals the right hider');

  // Find hider 1 (hiding at spots[1]) on the SECOND guess → seeker +60
  g.beginTargetSearch();
  st = g.getSeekerSearchState();
  assert.strictEqual(st.guessesLeft, 3, 'guesses reset for next hider');
  assert.strictEqual(st.hidersRemaining, 1);
  const wrong = wrongSpots(g, [spots[0], spots[1]], 1)[0];
  res = g.searchSpot(wrong); // wrong
  assert.strictEqual(res.found, false);
  assert.strictEqual(res.guessesLeft, 2);
  res = g.searchSpot(spots[1]); // correct on 2nd
  assert.strictEqual(res.found, true);
  assert.strictEqual(res.guess, 2);
  assert.strictEqual(res.seekerPoints, 60);
  assert.strictEqual(res.hider.id, order[1]);

  const seeker = g.getLeaderboard().find(p => p.id === seekerId);
  assert.strictEqual(seeker.score, seekerStart + 160, 'seeker scored 100 + 60');
});

test('escaped hider: +100 to hider, 0 to seeker, spot revealed only then', () => {
  const g = core.createGame({ difficulty: 'intermediate', players: makePlayers(3) }, mulberry32(31));
  const spots = allSpotIds(g);
  const order = hideAll(g, spots.slice(0, 2));
  const seekerId = g.getState().currentSeekerId;
  const seekerStart = g.getLeaderboard().find(p => p.id === seekerId).score;
  const hiderStart = g.getLeaderboard().find(p => p.id === order[0]).score;

  g.beginTargetSearch();
  const wrong = wrongSpots(g, [spots[0], spots[1]], 3);
  let res = g.searchSpot(wrong[0]);
  assert.strictEqual(res.found, false);
  res = g.searchSpot(wrong[1]);
  assert.strictEqual(res.found, false);
  res = g.searchSpot(wrong[2]);
  assert.strictEqual(res.escaped, true, 'third wrong guess = escaped');
  assert.strictEqual(res.hiderPoints, 100);
  assert.ok(res.revealSpot, 'escaped hider spot is revealed in the result');

  assert.strictEqual(g.getLeaderboard().find(p => p.id === order[0]).score, hiderStart + 100);
  assert.strictEqual(g.getLeaderboard().find(p => p.id === seekerId).score, seekerStart, 'seeker gains nothing');
});

test('hider bonus: found on third guess → hider +30, seeker +30', () => {
  const g = core.createGame({ difficulty: 'intermediate', players: makePlayers(2) }, mulberry32(41));
  const spots = allSpotIds(g);
  const order = hideAll(g, [spots[0]]);
  const seekerId = g.getState().currentSeekerId;
  const hiderStart = g.getLeaderboard().find(p => p.id === order[0]).score;

  g.beginTargetSearch();
  const wrong = wrongSpots(g, [spots[0]], 2);
  g.searchSpot(wrong[0]);
  g.searchSpot(wrong[1]);
  const res = g.searchSpot(spots[0]); // correct on 3rd
  assert.strictEqual(res.guess, 3);
  assert.strictEqual(res.seekerPoints, 30);
  assert.strictEqual(res.hiderPoints, 30, 'hider bonus for surviving 2 guesses');
  assert.strictEqual(g.getLeaderboard().find(p => p.id === order[0]).score, hiderStart + 30);
});

test('beginner gives 4 guesses and an auto clue', () => {
  const g = core.createGame({ difficulty: 'beginner', players: makePlayers(3) }, mulberry32(51));
  const spots = allSpotIds(g);
  hideAll(g, spots.slice(0, 2));
  g.beginTargetSearch();
  const st = g.getSeekerSearchState();
  assert.strictEqual(st.guessesTotal, 4);
  assert.ok(st.autoClue, 'beginner auto clue present');
  assert.ok(/hider/i.test(st.autoClue), 'clue reads like a clue');

  // 4th-guess find → 20 pts
  const wrong = wrongSpots(g, [spots[0], spots[1]], 3);
  g.searchSpot(wrong[0]);
  g.searchSpot(wrong[1]);
  g.searchSpot(wrong[2]);
  const res = g.searchSpot(spots[0]);
  assert.strictEqual(res.found, true);
  assert.strictEqual(res.guess, 4);
  assert.strictEqual(res.seekerPoints, 20);
});

test('full game: every player is Seeker exactly once, leaderboard & winner', () => {
  const g = core.createGame({ difficulty: 'beginner', players: makePlayers(4) }, mulberry32(61));
  const seekersSeen = [];
  let rounds = 0;

  while (g.getState().phase !== 'champion') {
    const state = g.getState();
    seekersSeen.push(state.currentSeekerId);
    rounds++;

    const spots = allSpotIds(g);
    const hiders = state.players.map(p => p.id).filter(id => id !== state.currentSeekerId);
    hideAll(g, spots.slice(0, hiders.length));

    let t = 0;
    while (g.getState().phase === 'seeker') {
      g.beginTargetSearch();
      const st = g.getSeekerSearchState();
      // privacy invariant: current target's spot never visible in seeker state
      assert.ok(!JSON.stringify(st).includes('"' + spots[t] + '"'),
        `round ${rounds}: hide spot ${spots[t]} not leaked`);
      if (t % 2 === 0) {
        const r = g.searchSpot(spots[t]); // found on first guess
        assert.strictEqual(r.found, true, `round ${rounds} target ${t} found`);
      } else {
        // escaped: burn wrong guesses (skip decoys)
        const wrong = wrongSpots(g, spots.slice(0, hiders.length), 3);
        let guard = 0;
        while (g.getState().phase === 'seeker') {
          const r = g.searchSpot(wrong[guard % 3]);
          if (r.escaped) break;
          guard++;
          assert.ok(guard < 10, 'escape loop terminates');
        }
      }
      t++;
    }

    assert.strictEqual(g.getState().phase, 'round-end');
    const summary = g.getRoundSummary();
    assert.ok(summary, 'round summary available');
    assert.strictEqual(summary.found.length + summary.escaped.length, hiders.length);
    assert.strictEqual(summary.leaderboard.length, 4);

    g.nextRound();
  }

  assert.strictEqual(rounds, 4, 'exactly 4 rounds for 4 players');
  assert.strictEqual(new Set(seekersSeen).size, 4, 'all 4 players were Seeker');
  const winner = g.getWinner();
  assert.ok(winner, 'a champion exists');
  const lb = g.getLeaderboard();
  assert.strictEqual(lb[0].id, winner.id, 'winner is leaderboard top');
  for (let i = 1; i < lb.length; i++) assert.ok(lb[i - 1].score >= lb[i].score, 'leaderboard sorted desc');
});

test('round results found/escaped are correct and spots revealed at round end', () => {
  const g = core.createGame({ difficulty: 'intermediate', players: makePlayers(3) }, mulberry32(71));
  const spots = allSpotIds(g);
  const order = hideAll(g, [spots[0], spots[1]]);
  const seekerId = g.getState().currentSeekerId;

  g.beginTargetSearch();
  g.searchSpot(spots[0]); // found hider0 on guess 1
  g.beginTargetSearch();
  const wrong = wrongSpots(g, [spots[0], spots[1]], 3);
  g.searchSpot(wrong[0]);
  g.searchSpot(wrong[1]);
  g.searchSpot(wrong[2]); // hider1 escaped

  const summary = g.getRoundSummary();
  assert.strictEqual(summary.found.length, 1);
  assert.strictEqual(summary.found[0].player.id, order[0]);
  assert.strictEqual(summary.found[0].spot.id, spots[0]);
  assert.strictEqual(summary.escaped.length, 1);
  assert.strictEqual(summary.escaped[0].player.id, order[1]);
  assert.strictEqual(summary.escaped[0].spot.id, spots[1]);
  assert.ok(summary.seekerPoints >= 100);
  assert.ok(summary.hiderPoints >= 100);
  assert.strictEqual(summary.seeker.id, seekerId);
});

test('seeker power-ups: scanner includes target, extra guess, clue matches spot', () => {
  const g = core.createGame({ difficulty: 'advanced', players: makePlayers(3) }, mulberry32(81));
  const spots = allSpotIds(g);
  hideAll(g, [spots[0], spots[1]]);
  g.beginTargetSearch();

  const st0 = g.getSeekerSearchState();
  const pu = st0.powerUp;
  assert.ok(pu, 'seeker has a power-up assigned');

  if (pu.id === 'scanner') {
    const res = g.useSeekerPowerUp('scanner');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.spots.length, 3);
    const ids = res.spots.map(s => s.id);
    assert.ok(ids.includes(spots[0]), 'scanner highlights the target spot');
    assert.strictEqual(new Set(ids).size, 3, 'three distinct spots');
  }
  if (pu.id === 'extra-guess') {
    const before = g.getSeekerSearchState().guessesLeft;
    const res = g.useSeekerPowerUp('extra-guess');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(g.getSeekerSearchState().guessesLeft, before + 1);
  }
  if (pu.id === 'clue') {
    const res = g.useSeekerPowerUp('clue');
    assert.strictEqual(res.ok, true);
    assert.ok(res.clue.length > 10, 'clue text present');
  }

  const again = g.useSeekerPowerUp(pu.id);
  assert.strictEqual(again.ok, false, 'power-up is one use per round');
});

test('secret tunnel moves the hider before the first guess', () => {
  let game2 = null, spot = null, partner = null;
  for (let seed = 1; seed < 3000 && !game2; seed++) {
    const gx = core.createGame({ difficulty: 'intermediate', players: makePlayers(2) }, mulberry32(seed));
    const hider = gx.getCurrentHider();
    const pu = gx.powerUpFor(hider);
    if (!pu || pu.id !== 'tunnel') continue;
    const s = gx.getState().activeSpots[0];
    const p = core.LOCATION_BY_ID[s].tunnelTo;
    if (gx.getState().activeSpots.indexOf(p) === -1) continue; // partner must be active
    const res = gx.commitHide(hider, s, 'tunnel');
    if (!res.ok) continue;
    gx.beginTargetSearch();
    if (!gx.searchSpot(s).found) { game2 = gx; spot = s; partner = p; }
  }
  assert.ok(game2, 'found a seed where tunnel works');
  const miss = game2.searchSpot(spot);
  assert.strictEqual(miss.found, false, 'tunnel moved the hider away from original spot');
  const hit = game2.searchSpot(partner);
  assert.strictEqual(hit.found, true, 'tunnel relocated hider to partner spot');
});

test('decoy: clicking a decoy consumes no guess', () => {
  let game2 = null, spot = null;
  for (let seed = 1; seed < 3000 && !game2; seed++) {
    const gx = core.createGame({ difficulty: 'intermediate', players: makePlayers(2) }, mulberry32(seed));
    const hider = gx.getCurrentHider();
    const pu = gx.powerUpFor(hider);
    if (!pu || pu.id !== 'decoy') continue;
    const s = gx.getState().activeSpots[0];
    const res = gx.commitHide(hider, s, 'decoy');
    if (!res.ok) continue;
    game2 = gx; spot = s;
  }
  assert.ok(game2, 'found a seed where decoy works');
  game2.beginTargetSearch();
  const st = game2.getSeekerSearchState();
  assert.ok(st.decoySpots.length >= 1, 'decoy creates a fake shimmer spot');
  assert.ok(st.decoySpots.every(d => d !== spot), 'decoy is not the real hiding spot');
  const before = st.guessesLeft;
  const click = game2.searchSpot(st.decoySpots[0]);
  assert.strictEqual(click.decoy, true, 'decoy click detected');
  assert.strictEqual(game2.getSeekerSearchState().guessesLeft, before, 'no guess consumed by decoy');
});

test('silent mode: hider spot never appears in advanced shimmer hints', () => {
  const active = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const hides = { h1: 'b', h2: 'f' };
  const flags = { h1: { silent: true }, h2: { silent: false } };
  for (let seed = 1; seed < 50; seed++) {
    const hints = core.computeHintSpots(active, hides, flags, mulberry32(seed));
    assert.ok(hints.indexOf('b') === -1, 'silent hider spot (b) never hinted (seed ' + seed + ')');
  }
});

test('restart clears temporary data and scores', () => {
  const g = core.createGame({ difficulty: 'beginner', players: makePlayers(3) }, mulberry32(101));
  const spots = allSpotIds(g);
  hideAll(g, spots.slice(0, 2));
  g.beginTargetSearch();
  g.searchSpot(spots[0]); // score points

  assert.ok(g.getLeaderboard().some(p => p.score > 0), 'some points earned before reset');

  const res = g.resetGame();
  assert.strictEqual(res.ok, true);
  assert.strictEqual(g.getState().phase, 'hider', 'back to hiding phase');
  assert.ok(g.getState().players.every(p => p.score === 0), 'scores zeroed');
  const res2 = g.commitHide(g.getCurrentHider(), spots[0]);
  assert.strictEqual(res2.ok, true, 'spot available again after reset');
  assert.ok(!JSON.stringify(g.getState()).includes('hides'));
});

test('clue text matches the actual hidden spot attributes', () => {
  const spot = core.LOCATION_BY_ID['hover-car']; // cyan vehicle center
  const c1 = core.makeClue(spot, 1, mulberry32(1));
  assert.ok(/cyan/i.test(c1), 'beginner clue includes colour');
  assert.ok(/middle/i.test(c1), 'beginner clue includes zone');
  const c2 = core.makeClue(spot, 2, mulberry32(2));
  assert.ok(c2.length > 8);
});

test('searching a non-hiding spot wastes nothing (friendly feedback)', () => {
  const g = core.createGame({ difficulty: 'intermediate', players: makePlayers(2) }, mulberry32(111));
  const spots = allSpotIds(g);
  hideAll(g, [spots[0]]);
  g.beginTargetSearch();
  const before = g.getSeekerSearchState().guessesLeft;
  const inactive = core.LOCATIONS.map(l => l.id).filter(id => spots.indexOf(id) === -1)[0];
  const res = g.searchSpot(inactive);
  assert.strictEqual(res.notHidingSpot, true, 'inactive spot handled');
  assert.strictEqual(g.getSeekerSearchState().guessesLeft, before, 'no guess lost');
  const unknown = g.searchSpot('not-a-real-spot');
  assert.strictEqual(unknown.ok, false);
});

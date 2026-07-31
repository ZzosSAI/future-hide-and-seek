/* ============================================================================
 * Future Hide & Seek — Game Core
 * ----------------------------------------------------------------------------
 * PURE GAME LOGIC ONLY. This file contains NO DOM access and no rendering.
 * It runs in the browser (attached to window.FHS) AND in Node.js (for tests).
 *
 * SECRECY DESIGN (important):
 *   - Hiding spots live in the module-private variable `hides`.
 *   - The UI can ONLY ever see hiding data through these "reveal paths":
 *       1. commitHide()        -> the hider's own confirmation (their own pick)
 *       2. beginTargetSearch() -> applies secret tunnels (no data leaked)
 *       3. searchSpot()        -> the result of a search (found / escaped)
 *       4. getRoundSummary()   -> revealed AFTER the round is over
 *   - getState() / getSeekerSearchState() NEVER include hide locations,
 *     so the Seeker's screen cannot accidentally render them.
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FHS = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------------
   * Difficulty settings
   * ---------------------------------------------------------------------- */
  var DIFFICULTIES = {
    beginner: {
      id: 'beginner',
      name: 'Beginner',
      spots: 10,          // how many hiding spots are active on the map
      guesses: 4,         // guesses per Hider
      autoClue: true,     // Seeker gets a free clue for every Hider
      highlight: true,    // UI shows labels + glowing outlines on all spots
      distractions: false,// no moving background objects
      shimmer: false      // no shimmer hints
    },
    intermediate: {
      id: 'intermediate',
      name: 'Intermediate',
      spots: 15,
      guesses: 3,
      autoClue: false,
      highlight: false,
      distractions: false,
      shimmer: false
    },
    advanced: {
      id: 'advanced',
      name: 'Advanced',
      spots: 22,
      guesses: 3,
      autoClue: false,
      highlight: false,
      distractions: true, // moving drones / cars on the map
      shimmer: true       // faint shimmer hints may appear on hidden spots
    }
  };

  /* ------------------------------------------------------------------------
   * Avatars (children pick one — no photos, no personal data)
   * ---------------------------------------------------------------------- */
  var AVATARS = [
    { id: 'explorer',  name: 'Space Explorer',   emoji: '🧑‍🚀', hue: '#ffb648' },
    { id: 'robot',     name: 'Robot Engineer',   emoji: '🤖',  hue: '#3dffa0' },
    { id: 'ninja',     name: 'Cyber Ninja',      emoji: '🥷',  hue: '#c77dff' },
    { id: 'scientist', name: 'Junior Scientist', emoji: '👩‍🔬', hue: '#4cc9f0' },
    { id: 'magician',  name: 'Hologram Magician',emoji: '🪄',  hue: '#ff9e64' },
    { id: 'alien',     name: 'Alien Adventurer', emoji: '👽',  hue: '#7bed9f' },
    { id: 'racer',     name: 'Hoverboard Racer', emoji: '🛹',  hue: '#ff7f50' },
    { id: 'detective', name: 'Future Detective', emoji: '🕵️',  hue: '#8aa2ff' }
  ];

  var COLOR_NAMES = {
    blue: 'blue', purple: 'purple', green: 'green',
    orange: 'orange', pink: 'pink', cyan: 'cyan'
  };

  /* ------------------------------------------------------------------------
   * Neon Future City — 22 hiding locations.
   * Each location: id, name (kid-friendly), emoji icon, position on the
   * 1000x640 map, click radius, clue attributes (zone / color / kind) and a
   * secret-tunnel partner.
   *   zone : 'left' | 'center' | 'right'      (for "left side" clues)
   *   color: 'blue'|'purple'|'green'|'orange'|'pink'|'cyan'  (for "near blue")
   *   kind : 'vehicle'|'building'|'outdoor'|'structure'      (for "in a ...")
   * ---------------------------------------------------------------------- */
  var LOCATIONS = [
    { id: 'holo-billboard', name: 'Behind the Hologram Billboard', emoji: '📺', x: 120, y: 120, r: 38, zone: 'left',   color: 'blue',   kind: 'structure', tunnelTo: 'telepod' },
    { id: 'robot-booth',    name: 'Inside the Robot Repair Booth', emoji: '🤖', x: 300, y: 90,  r: 38, zone: 'left',   color: 'orange', kind: 'building',  tunnelTo: 'control-room' },
    { id: 'hover-car',      name: 'Behind the Hover Car',          emoji: '🚗', x: 470, y: 560, r: 38, zone: 'center', color: 'cyan',   kind: 'vehicle',   tunnelTo: 'shuttle' },
    { id: 'supply-crate',   name: 'Inside the Supply Crate',       emoji: '📦', x: 200, y: 520, r: 38, zone: 'left',   color: 'orange', kind: 'structure', tunnelTo: 'locker' },
    { id: 'staircase',      name: 'Under the Futuristic Staircase',emoji: '🪜', x: 560, y: 140, r: 38, zone: 'center', color: 'purple', kind: 'structure', tunnelTo: 'fountain' },
    { id: 'vending',        name: 'Behind the Vending Machine',    emoji: '🥤', x: 830, y: 480, r: 38, zone: 'right',  color: 'pink',   kind: 'structure', tunnelTo: 'statue' },
    { id: 'telepod',        name: 'Inside the Teleportation Pod',  emoji: '🌀', x: 700, y: 200, r: 38, zone: 'right',  color: 'cyan',   kind: 'structure', tunnelTo: 'holo-billboard' },
    { id: 'big-plant',      name: 'Behind the Large Plant',        emoji: '🪴', x: 120, y: 300, r: 38, zone: 'left',   color: 'green',  kind: 'outdoor',   tunnelTo: 'cyber-trees' },
    { id: 'control-room',   name: 'Inside the Control Room',       emoji: '🖥️', x: 430, y: 90,  r: 38, zone: 'center', color: 'blue',   kind: 'building',  tunnelTo: 'robot-booth' },
    { id: 'info-screen',    name: 'Behind the City Info Screen',   emoji: '🗺️', x: 890, y: 250, r: 38, zone: 'right',  color: 'cyan',   kind: 'structure', tunnelTo: 'fuel-silo' },
    { id: 'tunnel',         name: 'Inside the Maintenance Tunnel', emoji: '🕳️', x: 380, y: 400, r: 38, zone: 'center', color: 'purple', kind: 'outdoor',   tunnelTo: 'drone-station' },
    { id: 'drone-station',  name: 'Behind the Delivery Drone Station', emoji: '🛸', x: 620, y: 500, r: 38, zone: 'center', color: 'orange', kind: 'structure', tunnelTo: 'tunnel' },
    { id: 'locker',         name: 'Inside the Storage Locker',     emoji: '🗄️', x: 240, y: 190, r: 38, zone: 'left',   color: 'blue',   kind: 'structure', tunnelTo: 'supply-crate' },
    { id: 'statue',         name: 'Behind the Glowing Statue',     emoji: '🗽', x: 780, y: 360, r: 38, zone: 'right',  color: 'purple', kind: 'outdoor',   tunnelTo: 'vending' },
    { id: 'shuttle',        name: 'Inside the Small Space Shuttle',emoji: '🚀', x: 930, y: 540, r: 38, zone: 'right',  color: 'pink',   kind: 'vehicle',   tunnelTo: 'hover-car' },
    { id: 'moon-dome',      name: 'Inside the Moon Colony Dome',   emoji: '🌙', x: 80,  y: 430, r: 38, zone: 'left',   color: 'green',  kind: 'building',  tunnelTo: 'roof-garden' },
    { id: 'fountain',       name: 'Behind the Neon Fountain',      emoji: '⛲', x: 520, y: 340, r: 38, zone: 'center', color: 'cyan',   kind: 'outdoor',   tunnelTo: 'staircase' },
    { id: 'fuel-silo',      name: 'Behind the Rocket Fuel Silo',   emoji: '🛢️', x: 860, y: 90,  r: 38, zone: 'right',  color: 'orange', kind: 'structure', tunnelTo: 'info-screen' },
    { id: 'cyber-trees',    name: 'Behind the Cyber Jungle Trees', emoji: '🌴', x: 60,  y: 380, r: 38, zone: 'left',   color: 'green',  kind: 'outdoor',   tunnelTo: 'big-plant' },
    { id: 'roof-garden',    name: 'Inside the Rooftop Garden',     emoji: '🌺', x: 620, y: 70,  r: 38, zone: 'center', color: 'green',  kind: 'outdoor',   tunnelTo: 'moon-dome' },
    { id: 'flying-car-slot',name: 'Inside the Flying-Car Parking Slot', emoji: '🚁', x: 520, y: 430, r: 38, zone: 'center', color: 'cyan', kind: 'vehicle', tunnelTo: 'arcade' },
    { id: 'arcade',         name: 'Inside the Hologram Arcade',    emoji: '🕹️', x: 760, y: 150, r: 38, zone: 'right',  color: 'pink',   kind: 'building',  tunnelTo: 'flying-car-slot' }
  ];

  var LOCATION_BY_ID = {};
  LOCATIONS.forEach(function (l) { LOCATION_BY_ID[l.id] = l; });

  /* ------------------------------------------------------------------------
   * Power-ups
   * ---------------------------------------------------------------------- */
  var SEEKER_POWERUPS = {
    'scanner':     { id: 'scanner',     name: 'Scanner Pulse',  desc: 'Highlights 3 spots — one hides the target!', emoji: '📡' },
    'clue':        { id: 'clue',        name: 'Robot Clue',     desc: 'The robot gives you a clue.',                 emoji: '🤖' },
    'extra-guess': { id: 'extra-guess', name: 'Extra Guess',    desc: 'Gain 1 extra guess for this Hider.',          emoji: '➕' }
  };
  var HIDER_POWERUPS = {
    'decoy':  { id: 'decoy',  name: 'Hologram Decoy', desc: 'A fake shimmer appears somewhere else on the map.', emoji: '✨' },
    'silent': { id: 'silent', name: 'Silent Mode',    desc: 'No shimmer hint can appear on your spot.',          emoji: '🔕' },
    'tunnel': { id: 'tunnel', name: 'Secret Tunnel',  desc: 'Moves you to a connected spot before the first guess.', emoji: '🚇' }
  };

  /* ------------------------------------------------------------------------
   * Helpers
   * ---------------------------------------------------------------------- */
  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

  /* Clue text ------------------------------------------------------------ */
  function colorText(spot) {
    return 'The hider is near something ' + COLOR_NAMES[spot.color] + '.';
  }
  function kindText(spot) {
    var m = {
      vehicle:   'inside a vehicle',
      building:  'inside a building',
      outdoor:   'out in the open',
      structure: 'near a city structure'
    };
    if (m[spot.kind]) return 'The hider is ' + m[spot.kind] + '.';
    return 'The hider is hidden somewhere in the city.';
  }
  function zoneText(spot) {
    var z = { left: 'on the left side of the city', center: 'in the middle of the city', right: 'on the right side of the city' };
    return 'The hider is ' + z[spot.zone] + '.';
  }
  /**
   * specificity 1 (Beginner auto clue): colour + zone  (still not the exact spot)
   * specificity 2 (Robot Clue power-up): one attribute
   */
  function makeClue(spot, specificity, rng) {
    if (specificity >= 1 && !spot) return 'The hider is somewhere in the city.';
    if (specificity >= 2) {
      return pick([colorText, kindText, zoneText], rng)(spot);
    }
    return colorText(spot) + ' ' + zoneText(spot);
  }

  /* ------------------------------------------------------------------------
   * Advanced shimmer hints: 1–2 random spots shimmer. A Hider who did NOT
   * use Silent Mode has a 40% chance that their spot joins the hints.
   * Silent Mode spots are NEVER included (pure function -> testable).
   * ---------------------------------------------------------------------- */
  function computeHintSpots(activeSpotIds, hides, hiderFlags, rng) {
    var silent = {};
    Object.keys(hides).forEach(function (pid) {
      var f = hiderFlags[pid] || {};
      if (f.silent) silent[hides[pid]] = true;
    });
    // Silent-mode spots are excluded from the random candidates too
    var candidates = activeSpotIds.filter(function (s) { return !silent[s]; });
    var hints = shuffle(candidates, rng).slice(0, 1 + Math.floor(rng() * 2));
    Object.keys(hides).forEach(function (pid) {
      var f = hiderFlags[pid] || {};
      if (f.silent) return;                    // Silent Mode: never hinted
      if (rng() < 0.4 && hints.indexOf(hides[pid]) === -1) {
        hints.push(hides[pid]);
      }
    });
    return hints;
  }

  /* ------------------------------------------------------------------------
   * Game factory
   * ---------------------------------------------------------------------- */
  function createGame(config, rng) {
    rng = rng || Math.random;
    var difficulty = DIFFICULTIES[config.difficulty] || DIFFICULTIES.intermediate;

    var players = config.players.map(function (p, i) {
      return {
        id: 'p' + i,
        name: String(p.name || '').trim() || 'Player ' + (i + 1),
        avatarId: p.avatarId || AVATARS[0].id,
        color: p.color || '#ffffff',
        score: 0,
        index: i
      };
    });
    if (players.length < 2 || players.length > 5) {
      throw new Error('Future Hide & Seek needs 2–5 players.');
    }

    /* ---- PRIVATE state (never exposed whole) ---- */
    var hides = {};            // hiderId -> spotId   <-- the secret data
    var hiderFlags = {};       // hiderId -> { silent, tunnel, decoy, tunnelApplied }
    var sealed = false;
    var phase = 'hider';       // 'hider' | 'seeker' | 'round-end' | 'champion'
    var currentRound = 1;
    var seekerOrder = shuffle(players.map(function (p) { return p.id; }), rng);
    var hiderQueue = [];       // hider ids in hiding-turn order
    var targets = [];          // hider ids in search order (same as hiderQueue)
    var targetIndex = 0;
    var resolved = [];         // { targetId, found, guess }
    var powerUps = {};         // playerId -> { power: id|null, used: bool }
    var activeSpotIds = shuffle(LOCATIONS.map(function (l) { return l.id; }), rng).slice(0, difficulty.spots);
    var hintSpots = [];
    var decoySpots = [];
    var scannerSpots = [];
    var seekerUsedPower = null;
    var guessesLeft = 0;
    var roundStartScores = {};

    function byId(id) { return players.find(function (p) { return p.id === id; }); }
    function seekerId() { return seekerOrder[currentRound - 1]; }
    function locInfo(id) {
      var l = LOCATION_BY_ID[id];
      return l ? { id: l.id, name: l.name, emoji: l.emoji } : null;
    }
    function playerInfo(id) {
      var p = byId(id);
      return p ? { id: p.id, name: p.name, avatarId: p.avatarId, color: p.color, score: p.score } : null;
    }
    function addScore(id, pts) { byId(id).score += pts; }

    function totalGuesses() {
      var extra = (seekerUsedPower === 'extra-guess') ? 1 : 0;
      return difficulty.guesses + extra;
    }
    function currentTarget() { return targets[targetIndex]; }
    function hiderSpot(id) { return hides[id]; }

    /* ---- Round lifecycle ---- */
    function initRound() {
      hides = {};
      hiderFlags = {};
      sealed = false;
      phase = 'hider';
      targetIndex = 0;
      resolved = [];
      seekerUsedPower = null;
      guessesLeft = 0;
      hintSpots = [];
      decoySpots = [];
      scannerSpots = [];
      var sk = seekerId();
      hiderQueue = shuffle(players.filter(function (p) { return p.id !== sk; }).map(function (p) { return p.id; }), rng);
      targets = hiderQueue.slice();
      powerUps = {};
      players.forEach(function (p) {
        var pool = p.id === sk
          ? Object.keys(SEEKER_POWERUPS)
          : Object.keys(HIDER_POWERUPS);
        powerUps[p.id] = { power: pick(pool, rng), used: false };
      });
      roundStartScores = {};
      players.forEach(function (p) { roundStartScores[p.id] = p.score; });
    }

    function sealHides() {
      if (hiderQueue.length > 0) return { ok: false, error: 'not-all-hidden' };
      sealed = true;
      phase = 'seeker';
      // decoy: one random empty spot per decoy user
      decoySpots = [];
      var taken = Object.values(hides);
      players.forEach(function (p) {
        var f = hiderFlags[p.id];
        if (f && f.decoy) {
          var empty = activeSpotIds.filter(function (s) { return taken.indexOf(s) === -1; });
          if (empty.length) decoySpots.push(pick(empty, rng));
        }
      });
      hintSpots = difficulty.shimmer ? computeHintSpots(activeSpotIds, hides, hiderFlags, rng) : [];
      return { ok: true };
    }

    /* ---- Hider actions ---- */
    function getCurrentHider() {
      return phase === 'hider' ? hiderQueue[0] : null;
    }
    function commitHide(playerId, spotId, powerUpId) {
      if (phase !== 'hider') return { ok: false, error: 'not-hiding-phase' };
      if (hiderQueue[0] !== playerId) return { ok: false, error: 'not-your-turn' };
      if (hides[playerId]) return { ok: false, error: 'already-hidden' };
      if (!spotId || !LOCATION_BY_ID[spotId]) return { ok: false, error: 'unknown-spot' };
      if (activeSpotIds.indexOf(spotId) === -1) return { ok: false, error: 'not-a-hiding-spot' };
      if (Object.keys(hides).some(function (id) { return hides[id] === spotId; })) {
        return { ok: false, error: 'taken' };
      }
      hides[playerId] = spotId;
      hiderFlags[playerId] = { silent: false, tunnel: false, decoy: false, tunnelApplied: false };
      var powerUsed = null;
      if (powerUpId) {
        var pu = powerUps[playerId];
        if (pu && pu.power === powerUpId && !pu.used) {
          pu.used = true;
          powerUsed = powerUpId;
          hiderFlags[playerId][powerUpId] = true;
        }
      }
      hiderQueue.shift();
      var sealedNow = false;
      if (hiderQueue.length === 0) {
        sealHides();
        sealedNow = true;
      }
      return {
        ok: true,
        spot: locInfo(spotId),
        powerUsed: powerUsed,
        nextHiderId: sealedNow ? null : hiderQueue[0],
        sealed: sealedNow
      };
    }

    /* ---- Seeker actions ---- */
    function beginTargetSearch() {
      if (phase !== 'seeker') return { ok: false, error: 'not-seeking' };
      var t = currentTarget();
      if (!t) return { ok: false, error: 'no-target' };
      // Secret Tunnel: relocate before the first guess (if the partner spot is valid)
      var f = hiderFlags[t];
      if (f && f.tunnel && !f.tunnelApplied) {
        var loc = LOCATION_BY_ID[hides[t]];
        var partner = loc && loc.tunnelTo;
        var taken = Object.values(hides).some(function (s) { return s === partner; });
        if (partner && activeSpotIds.indexOf(partner) !== -1 && !taken) {
          hides[t] = partner;
        }
        f.tunnelApplied = true;
      }
      guessesLeft = totalGuesses();
      return { ok: true };
    }

    function getSeekerSearchState() {
      var t = currentTarget();
      if (!t) return null;
      var p = byId(t);
      var clue = null;
      if (difficulty.autoClue) clue = makeClue(LOCATION_BY_ID[hides[t]], 1, rng);
      return {
        target: { id: p.id, name: p.name, avatarId: p.avatarId, color: p.color },
        guessesLeft: guessesLeft,
        guessesTotal: totalGuesses(),
        hidersRemaining: targets.length - targetIndex,
        hintSpots: hintSpots.slice(),
        decoySpots: decoySpots.slice(),
        scannerSpots: scannerSpots.slice(),
        autoClue: clue,
        powerUp: powerUpFor(seekerId()),
        difficultyId: difficulty.id
      };
    }

    function useSeekerPowerUp(id) {
      if (phase !== 'seeker') return { ok: false, error: 'not-seeking' };
      var pu = powerUps[seekerId()];
      if (!pu || pu.power !== id || pu.used) return { ok: false, error: 'not-available' };
      pu.used = true;
      seekerUsedPower = id;
      if (id === 'extra-guess') {
        guessesLeft += 1;
        return { ok: true, type: 'extra-guess', guessesLeft: guessesLeft };
      }
      if (id === 'scanner') {
        var t = currentTarget();
        var targetSpot = hides[t];
        var others = shuffle(activeSpotIds.filter(function (s) { return s !== targetSpot; }), rng).slice(0, 2);
        scannerSpots = shuffle([targetSpot].concat(others), rng);
        return { ok: true, type: 'scanner', spots: scannerSpots.map(locInfo) };
      }
      if (id === 'clue') {
        var spot = LOCATION_BY_ID[hides[currentTarget()]];
        return { ok: true, type: 'clue', clue: makeClue(spot, 2, rng) };
      }
      return { ok: false, error: 'unknown-power' };
    }

    function searchSpot(spotId) {
      if (phase !== 'seeker') return { ok: false, error: 'not-seeking' };
      var t = currentTarget();
      if (!t) return { ok: false, error: 'no-target' };
      if (!spotId || !LOCATION_BY_ID[spotId]) return { ok: false, error: 'unknown-spot' };
      if (activeSpotIds.indexOf(spotId) === -1) {
        return { ok: true, notHidingSpot: true };   // harmless: no guess lost
      }
      if (decoySpots.indexOf(spotId) !== -1) {
        return { ok: true, decoy: true };           // hologram: no guess lost
      }
      var targetSpot = hides[t];
      if (spotId === targetSpot) {
        var guess = totalGuesses() - guessesLeft + 1;
        var seekerPts = [100, 60, 30, 20][Math.min(guess, 4) - 1];
        var hiderPts = guess >= 3 ? 30 : 0;         // survived 2+ guesses
        addScore(seekerId(), seekerPts);
        addScore(t, hiderPts);
        resolved.push({ targetId: t, found: true, guess: guess });
        var res = {
          ok: true, found: true, guess: guess,
          seekerPoints: seekerPts, hiderPoints: hiderPts,
          hider: playerInfo(t), spot: locInfo(targetSpot)
        };
        advanceTarget();
        return res;
      }
      guessesLeft -= 1;
      if (guessesLeft <= 0) {
        addScore(t, 100);                           // Hider escaped!
        var g = totalGuesses() - guessesLeft;
        resolved.push({ targetId: t, found: false, guess: g });
        var res2 = {
          ok: true, found: false, escaped: true, guess: g,
          hiderPoints: 100, hider: playerInfo(t), revealSpot: locInfo(targetSpot)
        };
        advanceTarget();
        return res2;
      }
      return { ok: true, found: false, guess: totalGuesses() - guessesLeft, guessesLeft: guessesLeft };
    }

    function advanceTarget() {
      targetIndex += 1;
      if (targetIndex >= targets.length) phase = 'round-end';
    }

    /* ---- Round / game results ---- */
    function getRoundSummary() {
      if (phase !== 'round-end') return null;
      var found = [], escaped = [];
      resolved.forEach(function (r) {
        var item = {
          player: playerInfo(r.targetId),
          spot: locInfo(hides[r.targetId]),
          guess: r.guess
        };
        if (r.found) found.push(item); else escaped.push(item);
      });
      var seekerRound = byId(seekerId()).score - (roundStartScores[seekerId()] || 0);
      var hiderRound = players.reduce(function (sum, p) {
        return p.id === seekerId() ? sum : sum + (p.score - (roundStartScores[p.id] || 0));
      }, 0);
      return {
        round: currentRound,
        seeker: playerInfo(seekerId()),
        found: found,
        escaped: escaped,
        seekerPoints: seekerRound,
        hiderPoints: hiderRound,
        leaderboard: getLeaderboard()
      };
    }

    function nextRound() {
      if (currentRound >= players.length) {
        phase = 'champion';
        return { ok: true, gameOver: true, winner: getWinner(), leaderboard: getLeaderboard() };
      }
      currentRound += 1;
      initRound();
      return { ok: true, gameOver: false };
    }

    function getLeaderboard() {
      return players.slice().sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return a.index - b.index;
      }).map(function (p) { return { id: p.id, name: p.name, avatarId: p.avatarId, color: p.color, score: p.score }; });
    }

    function getWinner() {
      var lb = getLeaderboard();
      return lb.length ? lb[0] : null;
    }

    /* ---- Power-up access for UI ---- */
    function powerUpFor(playerId) {
      var pu = powerUps[playerId];
      if (!pu || !pu.power) return null;
      var meta = byId(playerId).id === seekerId()
        ? SEEKER_POWERUPS[pu.power]
        : HIDER_POWERUPS[pu.power];
      if (!meta) return null;
      return { id: pu.power, name: meta.name, desc: meta.desc, emoji: meta.emoji, used: pu.used };
    }

    /* ---- Public (sanitised) state ---- */
    function getState() {
      return {
        phase: phase,
        round: currentRound,
        roundTotal: players.length,
        difficulty: difficulty.id,
        difficultyName: difficulty.name,
        players: players.map(function (p) {
          return { id: p.id, name: p.name, avatarId: p.avatarId, color: p.color, score: p.score };
        }),
        currentSeekerId: seekerId(),
        hidersRemainingToHide: hiderQueue.length,
        activeSpots: activeSpotIds.slice(),
        guessesTotal: difficulty.guesses
      };
    }

    function resetGame() {
      currentRound = 1;
      seekerOrder = shuffle(players.map(function (p) { return p.id; }), rng);
      activeSpotIds = shuffle(LOCATIONS.map(function (l) { return l.id; }), rng).slice(0, difficulty.spots);
      players.forEach(function (p) { p.score = 0; });
      initRound();
      return { ok: true };
    }

    /* ---- Boot ---- */
    initRound();

    return {
      // data (read-only for UI)
      DIFFICULTIES: DIFFICULTIES,
      AVATARS: AVATARS,
      LOCATIONS: LOCATIONS,
      SEEKER_POWERUPS: SEEKER_POWERUPS,
      HIDER_POWERUPS: HIDER_POWERUPS,
      difficulty: difficulty,
      // state
      getState: getState,
      getLeaderboard: getLeaderboard,
      getWinner: getWinner,
      // hider flow
      getCurrentHider: getCurrentHider,
      commitHide: commitHide,
      powerUpFor: powerUpFor,
      // seeker flow
      beginTargetSearch: beginTargetSearch,
      getSeekerSearchState: getSeekerSearchState,
      useSeekerPowerUp: useSeekerPowerUp,
      searchSpot: searchSpot,
      // round flow
      getRoundSummary: getRoundSummary,
      nextRound: nextRound,
      resetGame: resetGame,
      // helpers (pure, exported for tests)
      computeHintSpots: computeHintSpots,
      makeClue: makeClue,
      createGame: createGame
    };
  }

  return {
    createGame: createGame,
    DIFFICULTIES: DIFFICULTIES,
    AVATARS: AVATARS,
    LOCATIONS: LOCATIONS,
    LOCATION_BY_ID: LOCATION_BY_ID,
    SEEKER_POWERUPS: SEEKER_POWERUPS,
    HIDER_POWERUPS: HIDER_POWERUPS,
    computeHintSpots: computeHintSpots,
    makeClue: makeClue
  };
}));

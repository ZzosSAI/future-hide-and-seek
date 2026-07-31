/* ============================================================================
 * Future Hide & Seek — UI layer
 * ----------------------------------------------------------------------------
 * All rendering, screens, sounds, confetti, tutorial and input handling.
 * The game RULES live in game-core.js; this file only talks to the core
 * through its public (sanitised) API — it never sees raw hiding data.
 * ========================================================================== */
(function () {
  'use strict';

  var FHS = window.FHS;
  if (!FHS) { console.error('game-core.js must load first'); return; }

  /* ======================= Settings & persistence ======================= */
  var LS_SETTINGS = 'fhs_settings';
  var LS_TUTORIAL = 'fhs_tutorial_seen';
  var LS_NAMES = 'fhs_names';
  var LS_CHAMPS = 'fhs_champs';

  function lsGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  var settings = lsGet(LS_SETTINGS, { musicOn: true, sfxOn: true, volume: 80 });

  /* ======================= Colour map for spots ======================= */
  var NEON = {
    blue: '#4cc9f0', purple: '#c77dff', green: '#3dffa0',
    orange: '#ffb648', pink: '#ff7ad9', cyan: '#00f0ff'
  };

  /* ======================= Small helpers ======================= */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function avatarEmoji(avatarId) {
    var a = FHS.AVATARS.find(function (x) { return x.id === avatarId; });
    return a ? a.emoji : '🙂';
  }
  function playerById(state, id) {
    return state.players.find(function (p) { return p.id === id; });
  }
  function spotById(id) {
    return FHS.LOCATION_BY_ID[id] || null;
  }

  function $(id) { return document.getElementById(id); }

  function show(id) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
    $(id).classList.add('active');
    window.scrollTo(0, 0);
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2200);
  }

  /* ======================= Modal ======================= */
  var modalRoot = $('modal-root');
  var modalCard = $('modal-card');

  function showModal(html) {
    modalCard.innerHTML = html;
    modalRoot.hidden = false;
    modalCard.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () { modalAction(btn.getAttribute('data-action')); });
    });
  }
  function hideModal() { modalRoot.hidden = true; modalCard.innerHTML = ''; }

  /* ======================= Audio ======================= */
  var AudioMan = {
    ctx: null, master: null, musicGain: null, sfxGain: null, musicTimer: null,
    ensure: function () {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = settings.volume / 100;
        this.master.connect(this.ctx.destination);
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = settings.musicOn ? 1 : 0;
        this.musicGain.connect(this.master);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = settings.sfxOn ? 1 : 0;
        this.sfxGain.connect(this.master);
      } catch (e) { this.ctx = null; }
    },
    tone: function (freq, when, dur, type, vol, dest) {
      if (!this.ctx) return;
      var d = dest || this.sfxGain;
      var t = this.ctx.currentTime + (when || 0);
      var osc = this.ctx.createOscillator();
      var g = this.ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(d);
      osc.start(t); osc.stop(t + dur + 0.05);
    },
    click: function () { this.tone(660, 0, 0.06, 'square', 0.08); },
    select: function () { this.tone(500, 0, 0.09, 'sine', 0.1); this.tone(800, 0.07, 0.1, 'sine', 0.1); },
    hide: function () { this.tone(392, 0, 0.12, 'triangle', 0.12); this.tone(523, 0.1, 0.16, 'triangle', 0.12); },
    scan: function () {
      var self = this;
      [900, 700, 520, 380, 260].forEach(function (f, i) { self.tone(f, i * 0.06, 0.08, 'sawtooth', 0.06); });
    },
    wrong: function () { this.tone(190, 0, 0.22, 'sawtooth', 0.1); this.tone(140, 0.12, 0.24, 'sawtooth', 0.08); },
    found: function () {
      var self = this;
      [523, 659, 784, 1046].forEach(function (f, i) { self.tone(f, i * 0.09, 0.14, 'triangle', 0.14); });
    },
    escape: function () {
      var self = this;
      [600, 480, 360, 240, 150].forEach(function (f, i) { self.tone(f, i * 0.07, 0.09, 'sine', 0.11); });
    },
    decoy: function () {
      var self = this;
      [340, 460, 340, 460].forEach(function (f, i) { self.tone(f, i * 0.08, 0.07, 'square', 0.05); });
    },
    round: function () {
      var self = this;
      [392, 523, 659].forEach(function (f, i) { self.tone(f, i * 0.1, 0.16, 'triangle', 0.13); });
    },
    victory: function () {
      var self = this;
      [523, 659, 784, 1046, 784, 1046, 1318].forEach(function (f, i) { self.tone(f, i * 0.13, 0.2, 'triangle', 0.15); });
    },
    startMusic: function () {
      this.ensure();
      if (!this.ctx || this.musicTimer) return;
      if (window.__FHS_DISABLE_MUSIC__) return;   // used by automated tests
      var self = this;
      var stepDur = 60 / 112 / 2;               // 112 bpm, eighth notes
      var bass = [130.81, 98.0, 110.0, 87.31];  // C3 G2 A2 F2
      var arp = [523.25, 659.25, 783.99, 880.0, 783.99, 659.25, 587.33, 523.25];
      var bar = 0;
      var nextTime = this.ctx.currentTime + 0.1;
      function schedule() {
        while (nextTime < self.ctx.currentTime + 0.5) {
          var step = bar % 8;
          self.tone(arp[step], nextTime - self.ctx.currentTime, stepDur * 0.92, 'triangle', 0.05, self.musicGain);
          if (step === 0) {
            self.tone(bass[(Math.floor(bar / 8)) % 4], nextTime - self.ctx.currentTime, stepDur * 4, 'sine', 0.07, self.musicGain);
          }
          nextTime += stepDur;
          bar++;
        }
      }
      schedule();
      this.musicTimer = setInterval(schedule, 150);
    },
    stopMusic: function () {
      if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
    }
  };

  function refreshAudioUI() {
    var m = $('btn-toggle-music'), s = $('btn-toggle-sfx'), v = $('volume-slider');
    if (m) m.textContent = settings.musicOn ? '🎵 Music: ON' : '🔇 Music: OFF';
    if (s) s.textContent = settings.sfxOn ? '🔊 Sound: ON' : '🔈 Sound: OFF';
    if (v) v.value = settings.volume;
  }
  function updateAudioGains() {
    if (!AudioMan.ctx) return;
    AudioMan.master.gain.value = settings.volume / 100;
    AudioMan.musicGain.gain.value = settings.musicOn ? 1 : 0;
    AudioMan.sfxGain.gain.value = settings.sfxOn ? 1 : 0;
  }

  /* ======================= Confetti ======================= */
  var Confetti = {
    parts: [], running: false, canvas: null, ctx2d: null,
    launch: function (count) {
      this.canvas = $('confetti-canvas');
      if (!this.canvas || !this.canvas.getContext) return;
      this.ctx2d = this.canvas.getContext('2d');
      if (!this.ctx2d) return;              // no 2D context (e.g. headless) — skip
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
      var colors = ['#00f0ff', '#c77dff', '#ff7ad9', '#3dffa0', '#ffe45c', '#ffb648', '#ffffff'];
      for (var i = 0; i < (count || 150); i++) {
        this.parts.push({
          x: Math.random() * this.canvas.width,
          y: -20 - Math.random() * this.canvas.height * 0.5,
          w: 6 + Math.random() * 8,
          h: 8 + Math.random() * 10,
          vy: 2 + Math.random() * 3.5,
          vx: -1.5 + Math.random() * 3,
          rot: Math.random() * Math.PI * 2,
          vr: -0.15 + Math.random() * 0.3,
          color: colors[Math.floor(Math.random() * colors.length)]
        });
      }
      if (!this.running) { this.running = true; this.loop(); }
    },
    loop: function () {
      var self = this;
      var ctx = this.ctx2d;
      if (!ctx) { this.running = false; return; }
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      var alive = false;
      this.parts.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        if (p.y < this.canvas.height + 30) alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }, this);
      this.parts = this.parts.filter(function (p) { return p.y < this.canvas.height + 30; }, this);
      if (this.parts.length) {
        requestAnimationFrame(this.loop.bind(this));
      } else {
        this.running = false;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }
  };

  /* ======================= The city map (SVG) ======================= */
  function buildCitySVG() {
    var parts = [];
    parts.push('<svg viewBox="0 0 1000 640" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Neon Future City map">');
    parts.push('<defs>');
    parts.push('<linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">');
    parts.push('<stop offset="0" stop-color="#0b1030"/><stop offset="0.55" stop-color="#1a1240"/><stop offset="1" stop-color="#241a55"/>');
    parts.push('</linearGradient>');
    parts.push('<linearGradient id="floorGrad" x1="0" y1="0" x2="0" y2="1">');
    parts.push('<stop offset="0" stop-color="#161a44"/><stop offset="1" stop-color="#0c1030"/>');
    parts.push('</linearGradient>');
    parts.push('<radialGradient id="moonGrad"><stop offset="0" stop-color="#e8ecff"/><stop offset="1" stop-color="#8f9bff"/></radialGradient>');
    parts.push('</defs>');

    // Sky + stars
    parts.push('<rect width="1000" height="640" fill="url(#skyGrad)"/>');
    for (var i = 0; i < 46; i++) {
      var sx = (i * 137.5 + 13) % 1000;
      var sy = (i * 89.3 + 7) % 360;
      var sr = 0.6 + (i % 3) * 0.5;
      parts.push('<circle cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="' + sr.toFixed(1) +
        '" fill="#cfd6ff" opacity="' + (0.25 + (i % 5) * 0.12).toFixed(2) + '"/>');
    }
    // Moon
    parts.push('<circle cx="868" cy="120" r="58" fill="url(#moonGrad)" opacity="0.9"/>');
    parts.push('<circle cx="850" cy="102" r="10" fill="#aab3ff" opacity="0.5"/>');
    parts.push('<circle cx="884" cy="140" r="7" fill="#aab3ff" opacity="0.5"/>');
    parts.push('<circle cx="872" cy="92" r="5" fill="#aab3ff" opacity="0.5"/>');

    // Neon signs (background text)
    parts.push('<g class="neon-sign" opacity="0.55"><text class="sign-text" x="500" y="62" text-anchor="middle" font-size="42" font-weight="700" fill="#00f0ff" font-family="Fredoka, Arial, sans-serif">NEON CITY</text></g>');
    parts.push('<g class="neon-sign" opacity="0.4"><text class="sign-text" x="196" y="240" text-anchor="middle" font-size="20" font-weight="700" fill="#c77dff" font-family="Fredoka, Arial, sans-serif">HOLO MALL</text></g>');
    parts.push('<g class="neon-sign" opacity="0.4"><text class="sign-text" x="806" y="300" text-anchor="middle" font-size="20" font-weight="700" fill="#ff7ad9" font-family="Fredoka, Arial, sans-serif">SPACE DOCK</text></g>');

    // City buildings (silhouette with neon windows)
    for (i = 0; i < 15; i++) {
      var bx = i * 70 - 12 + (i % 3) * 9;
      var bw = 52 + ((i * 13) % 42);
      var bh = 150 + ((i * 29) % 160);
      var by = 640 - bh;
      parts.push('<rect x="' + bx + '" y="' + by + '" width="' + bw + '" height="' + bh + '" fill="#141238" stroke="#262b5e" stroke-width="2"/>');
      for (var wy = by + 14; wy < by + bh - 10; wy += 22) {
        for (var wx = bx + 9; wx < bx + bw - 12; wx += 17) {
          if ((i * 7 + wx + wy) % 6 < 2) {
            var wcol = ['#00f0ff', '#c77dff', '#3dffa0', '#ff7ad9'][(i + Math.floor(wx / 17)) % 4];
            parts.push('<rect x="' + wx + '" y="' + wy + '" width="7" height="9" rx="1.5" fill="' + wcol + '" opacity="0.75"/>');
          }
        }
      }
    }

    // Plaza floor + grid
    parts.push('<rect x="0" y="360" width="1000" height="280" fill="url(#floorGrad)" opacity="0.97"/>');
    for (var gx = 50; gx < 1000; gx += 50) {
      parts.push('<line x1="' + gx + '" y1="360" x2="' + gx + '" y2="640" stroke="#ffffff" stroke-width="1" opacity="0.05"/>');
    }
    for (var gy = 390; gy < 640; gy += 50) {
      parts.push('<line x1="0" y1="' + gy + '" x2="1000" y2="' + gy + '" stroke="#ffffff" stroke-width="1" opacity="0.05"/>');
    }

    // Roads
    parts.push('<rect x="0" y="545" width="1000" height="26" fill="#0b0f2c"/>');
    parts.push('<line x1="0" y1="558" x2="1000" y2="558" stroke="#2e3f7d" stroke-width="3" stroke-dasharray="34 28"/>');
    parts.push('<rect x="475" y="360" width="26" height="280" fill="#0b0f2c"/>');
    parts.push('<line x1="488" y1="360" x2="488" y2="640" stroke="#2e3f7d" stroke-width="3" stroke-dasharray="34 28"/>');

    // Advanced distractions (hidden unless .distractions class is on the svg)
    parts.push('<g class="drone"><g><circle cx="0" cy="250" r="14" fill="#ffd166"/><circle cx="0" cy="240" r="16" fill="none" stroke="#ffd166" stroke-width="3" opacity="0.5"/><text x="0" y="256" text-anchor="middle" font-size="16">🤖</text></g></g>');
    parts.push('<g class="hover-car-anim"><g><rect x="-8" y="170" width="34" height="14" rx="7" fill="#ff7ad9" opacity="0.9"/><circle cx="2" cy="186" r="4" fill="#0b0f2c"/><circle cx="14" cy="186" r="4" fill="#0b0f2c"/></g></g>');

    // Hiding spots (all 22)
    FHS.LOCATIONS.forEach(function (loc) {
      var hex = NEON[loc.color] || '#00f0ff';
      var x = loc.x, y = loc.y;
      parts.push('<g class="spot" data-spot="' + loc.id + '">');
      parts.push('<circle class="spot-hit" cx="' + x + '" cy="' + y + '" r="' + loc.r + '"/>');
      parts.push('<rect class="spot-bg" x="' + (x - 26) + '" y="' + (y - 26) + '" width="52" height="52" rx="14" stroke="' + hex + '"/>');
      parts.push('<rect class="spot-glow" x="' + (x - 31) + '" y="' + (y - 31) + '" width="62" height="62" rx="17" stroke="' + hex + '"/>');
      parts.push('<text class="spot-emoji" x="' + x + '" y="' + (y + 7) + '" text-anchor="middle" font-size="26">' + loc.emoji + '</text>');
      parts.push('<text class="spot-label" x="' + x + '" y="' + (y + 47) + '" text-anchor="middle">' + esc(loc.name) + '</text>');
      parts.push('<circle class="spot-pulse" cx="' + x + '" cy="' + y + '" r="26" stroke="' + hex + '"/>');
      parts.push('<circle class="spot-shimmer" cx="' + x + '" cy="' + y + '" r="28" stroke="#ffffff"/>');
      parts.push('<circle class="found-burst" cx="' + x + '" cy="' + y + '" r="16" stroke="' + hex + '"/>');
      parts.push('</g>');
    });

    parts.push('</svg>');
    return parts.join('');
  }

  function renderMap(container, mode) {
    var state = game.getState();
    var difficulty = FHS.DIFFICULTIES[state.difficulty];
    container.innerHTML = buildCitySVG();
    var svg = container.querySelector('svg');
    if (difficulty.distractions) svg.classList.add('distractions');

    container.querySelectorAll('.spot').forEach(function (el) {
      var id = el.getAttribute('data-spot');
      var active = state.activeSpots.indexOf(id) !== -1;
      el.classList.toggle('inactive', !active);
      el.classList.toggle('beginner-active', active && difficulty.highlight);
      el.classList.toggle('show-label', active && difficulty.highlight);
      el.classList.toggle('selected', id === U.pendingSpot);
    });

    if (mode === 'seek') {
      var st = game.getSeekerSearchState();
      if (st) {
        st.hintSpots.forEach(function (id) { addSpotClass(container, id, 'shimmer'); });
        st.decoySpots.forEach(function (id) { addSpotClass(container, id, 'decoy'); });
        st.scannerSpots.forEach(function (id) { addSpotClass(container, id, 'scan'); });
      }
    }
  }
  function addSpotClass(container, id, cls) {
    var el = container.querySelector('.spot[data-spot="' + id + '"]');
    if (el) el.classList.add(cls);
  }

  /* ======================= Top bar ======================= */
  function renderTopbar(el, player, role, state, seekState) {
    var chips = '';
    if (role === 'seeker' && seekState) {
      chips += '<span class="tb-chip guesses">🎯 Guesses <span class="tb-big">' + seekState.guessesLeft + '/' + seekState.guessesTotal + '</span></span>';
      chips += '<span class="tb-chip">🙋 Hiders left <span class="tb-big">' + seekState.hidersRemaining + '</span></span>';
    }
    if (role === 'hider') {
      chips += '<span class="tb-chip">🙈 Hiders left to hide <span class="tb-big">' + state.hidersRemainingToHide + '</span></span>';
    }
    el.innerHTML =
      '<div class="tb-player"><span class="tb-avatar">' + avatarEmoji(player.avatarId) + '</span>' +
      '<span>' + esc(player.name) + '</span>' +
      '<span class="tb-role ' + role + '">' + (role === 'seeker' ? '🔍 Seeker' : '🙈 Hider') + '</span></div>' +
      '<div class="tb-chips">' +
      '<span class="tb-chip score">⭐ Score <span class="tb-big">' + player.score + '</span></span>' + chips +
      '<span class="tb-chip round">🌀 Round <span class="tb-big">' + state.round + '/' + state.roundTotal + '</span></span>' +
      '</div>' +
      '<div class="tb-chips">' +
      '<button class="btn btn-small" data-action="toggle-music" title="Music on/off">' + (settings.musicOn ? '🎵' : '🔇') + '</button>' +
      '<button class="btn btn-small" data-action="toggle-sfx" title="Sound on/off">' + (settings.sfxOn ? '🔊' : '🔈') + '</button>' +
      '</div>';
    el.querySelectorAll('[data-action]').forEach(function (b) {
      b.addEventListener('click', function () { modalAction(b.getAttribute('data-action')); });
    });
  }

  /* ======================= Game flow ======================= */
  var game = null;
  var U = { pendingSpot: null, pendingPowerUp: null, seekPhaseBusy: false };
  var tutorialStep = 0;
  var setupPlayers = 2;
  var setupDifficulty = 'intermediate';
  var setupData = [];
  var tutorialSeen = lsGet(LS_TUTORIAL, false) === true || lsGet(LS_TUTORIAL, false) === '1';

  /* ---------- Main menu ---------- */
  function renderMenu() {
    refreshAudioUI();
    var champs = lsGet(LS_CHAMPS, []);
    var list = $('champs-list');
    if (!champs.length) {
      list.innerHTML = '<p class="muted">No champions yet — be the first!</p>';
    } else {
      var medals = ['🥇', '🥈', '🥉'];
      list.innerHTML = champs.slice(0, 5).map(function (c, i) {
        return '<div class="champ-entry"><span><span class="champ-medal">' + (medals[i] || '🏅') + '</span>' + esc(c.name) + '</span>' +
          '<span class="pts" style="color:var(--green);font-weight:700">' + c.score + ' pts</span></div>';
      }).join('');
    }
  }

  /* ---------- Setup ---------- */
  function initSetup() {
    setupData = [];
    for (var i = 0; i < setupPlayers; i++) {
      var saved = lsGet(LS_NAMES, []);
      setupData.push({
        name: saved[i] || '',
        avatarId: FHS.AVATARS[i % FHS.AVATARS.length].id,
        color: FHS.AVATARS[i % FHS.AVATARS.length].hue
      });
    }
    renderSetup();
  }
  function renderSetup() {
    document.querySelectorAll('#count-row .chip').forEach(function (c) {
      c.classList.toggle('selected', parseInt(c.dataset.count, 10) === setupPlayers);
    });
    document.querySelectorAll('#diff-row .diff-card').forEach(function (c) {
      c.classList.toggle('selected', c.dataset.diff === setupDifficulty);
    });
    var wrap = $('player-cards');
    wrap.innerHTML = setupData.map(function (p, i) {
      var avatars = FHS.AVATARS.map(function (a) {
        return '<button class="avatar-btn' + (a.id === p.avatarId ? ' selected' : '') + '" data-avatar="' + a.id + '" data-p="' + i + '" title="' + esc(a.name) + '">' + a.emoji + '</button>';
      }).join('');
      var colors = FHS.AVATARS.map(function (a) { return a.hue; });
      var swatches = colors.map(function (c) {
        return '<button class="color-btn' + (c === p.color ? ' selected' : '') + '" data-color="' + c + '" data-p="' + i + '" style="background:' + c + '"></button>';
      }).join('');
      return '<div class="player-card" data-p="' + i + '">' +
        '<div class="pcard-head"><span class="tb-avatar">' + avatarEmoji(p.avatarId) + '</span> Player ' + (i + 1) + '</div>' +
        '<input type="text" maxlength="14" placeholder="Name…" value="' + esc(p.name) + '" data-p="' + i + '">' +
        '<div class="avatar-row">' + avatars + '</div>' +
        '<div class="field-label" style="font-size:0.85rem;margin-top:6px">Favourite colour</div>' +
        '<div class="color-row">' + swatches + '</div>' +
        '</div>';
    }).join('');

    wrap.querySelectorAll('input[type="text"]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        setupData[parseInt(inp.dataset.p, 10)].name = inp.value;
      });
    });
    wrap.querySelectorAll('.avatar-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        setupData[parseInt(b.dataset.p, 10)].avatarId = b.dataset.avatar;
        renderSetup();
      });
    });
    wrap.querySelectorAll('.color-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        setupData[parseInt(b.dataset.p, 10)].color = b.dataset.color;
        renderSetup();
      });
    });
  }

  function startGame() {
    var players = setupData.map(function (p, i) {
      return { name: p.name.trim() || 'Player ' + (i + 1), avatarId: p.avatarId, color: p.color };
    });
    // remember names for next time
    lsSet(LS_NAMES, players.map(function (p) { return p.name; }));

    game = FHS.createGame({ players: players, difficulty: setupDifficulty });
    AudioMan.ensure();
    if (settings.musicOn) AudioMan.startMusic();

    if (!tutorialSeen) {
      tutorialStep = 0;
      renderTutorial();
      show('screen-tutorial');
    } else {
      goHideTurn();
    }
  }

  /* ---------- Tutorial ---------- */
  var TUTORIAL = [
    { emoji: '🙈', title: 'Hiders secretly choose a place', text: 'When it is your turn, tap ONE hiding spot on the city map. Do not let anyone else see where you hide!' },
    { emoji: '📱', title: 'Pass the device without showing your hiding place', text: 'Tap “Ready — Pass to the Next Player”. The next player never sees your spot!' },
    { emoji: '🔍', title: 'The Seeker clicks locations to search', text: 'The Seeker taps spots on the city map to look for Hiders. Simple!' },
    { emoji: '🎯', title: 'The Seeker gets three guesses for each Hider', text: 'Three guesses on Intermediate — four on Beginner. Spend them wisely!' },
    { emoji: '⭐', title: 'Earn points by finding players or staying hidden', text: 'Seekers get 100, 60 or 30 points per find. Hiders get 100 points for escaping!' },
    { emoji: '🏆', title: 'The player with the highest score wins!', text: 'Everyone gets a turn as Seeker. The highest total score becomes the Future Hide & Seek Champion!' }
  ];
  function renderTutorial() {
    var step = TUTORIAL[tutorialStep];
    $('tut-emoji').textContent = step.emoji;
    $('tut-title').textContent = step.title;
    $('tut-text').textContent = step.text;
    $('btn-tut-back').style.display = tutorialStep === 0 ? 'none' : 'inline-flex';
    $('btn-tut-next').textContent = tutorialStep === TUTORIAL.length - 1 ? 'Start Game ▶' : 'Next ▶';
    $('tut-dots').innerHTML = TUTORIAL.map(function (_, i) {
      return '<span class="tut-dot' + (i === tutorialStep ? ' active' : '') + '"></span>';
    }).join('');
  }
  function finishTutorial() {
    tutorialSeen = true;
    lsSet(LS_TUTORIAL, true);
    goHideTurn();
  }

  /* ---------- Hider turn ---------- */
  function goHideTurn() {
    var state = game.getState();
    if (state.phase !== 'hider') { goSeekPhase(); return; }
    var hiderId = game.getCurrentHider();
    var player = playerById(state, hiderId);
    renderTopbar($('topbar-hide'), player, 'hider', state);

    var pu = game.powerUpFor(hiderId);
    var banner = '🙈 <b>' + esc(player.name) + '</b>, choose your secret hiding place!';
    banner += '<span class="banner-sub">Do not let the Seeker see! Tap a glowing spot on the city.</span>';
    if (pu && !pu.used) {
      banner += '<span class="clue-box">⚡ Your power-up: ' + pu.emoji + ' ' + esc(pu.name) + ' — ' + esc(pu.desc) + '</span>';
    }
    $('hide-banner').innerHTML = banner;

    U.pendingSpot = null;
    U.pendingPowerUp = null;
    renderMap($('map-hide'), 'hide');
    show('screen-hide');
  }

  function handleHideMapClick(e) {
    var spotEl = e.target.closest ? e.target.closest('.spot') : null;
    if (!spotEl || !game) return;
    var spotId = spotEl.getAttribute('data-spot');
    var state = game.getState();
    if (state.phase !== 'hider') return;
    if (state.activeSpots.indexOf(spotId) === -1) {
      toast('❌ That is not a hiding place — look for the glowing spots!');
      AudioMan.wrong();
      return;
    }
    var loc = spotById(spotId);
    U.pendingSpot = spotId;
    U.pendingPowerUp = null;
    renderMap($('map-hide'), 'hide');
    AudioMan.select();

    var pu = game.powerUpFor(game.getCurrentHider());
    var puHtml = '';
    if (pu && !pu.used) {
      puHtml = '<button class="pu-option" data-action="toggle-hider-power" style="width:100%">' +
        '<span class="pu-emoji">' + pu.emoji + '</span>' +
        '<span><b>Use Power-Up: ' + esc(pu.name) + '</b><br><span class="muted">' + esc(pu.desc) + '</span></span></button>';
    }
    showModal(
      '<div class="modal-emoji">🙈</div>' +
      '<div class="modal-title">Hide here?</div>' +
      '<div class="modal-text big">' + esc(loc.name) + '</div>' +
      '<div class="modal-buttons">' + puHtml +
      '<button class="btn btn-primary" data-action="confirm-hide">Confirm Hiding Place ✓</button>' +
      '<button class="btn btn-secondary" data-action="cancel-hide">Choose Another Place</button>' +
      '</div>'
    );
  }

  function confirmHide() {
    if (!U.pendingSpot || !game) return;
    var hiderId = game.getCurrentHider();
    var res = game.commitHide(hiderId, U.pendingSpot, U.pendingPowerUp);
    if (!res.ok) {
      if (res.error === 'taken') {
        AudioMan.wrong();
        showModal(
          '<div class="modal-emoji">😅</div>' +
          '<div class="modal-title">Already taken!</div>' +
          '<div class="modal-text">That hiding place is already taken. Choose another one!</div>' +
          '<div class="modal-buttons"><button class="btn btn-primary" data-action="cancel-hide">Choose Another Place</button></div>'
        );
        return;
      }
      showModal('<div class="modal-text">Hmm, that did not work. Try again!</div>' +
        '<div class="modal-buttons"><button class="btn btn-primary" data-action="close-modal">OK</button></div>');
      return;
    }
    AudioMan.hide();
    hideModal();
    U.pendingSpot = null;
    U.pendingPowerUp = null;

    if (res.sealed) {
      // all hiders hidden → pass to the Seeker
      var state = game.getState();
      var seeker = playerById(state, state.currentSeekerId);
      showPrivacy(null, seeker, 'The Seeker is about to search the city. Everyone\u2019s hiding spots stay secret!');
    } else {
      var next = playerById(game.getState(), res.nextHiderId);
      showPrivacy(next, null, 'Do not let them see your hiding place!');
    }
  }

  function toggleHiderPower() {
    U.pendingPowerUp = U.pendingPowerUp ? null : game.powerUpFor(game.getCurrentHider()).id;
    var pu = FHS.HIDER_POWERUPS[U.pendingPowerUp];
    var btn = modalCard.querySelector('[data-action="toggle-hider-power"]');
    if (U.pendingPowerUp && btn) {
      btn.style.borderColor = '#3dffa0';
      btn.querySelector('b').textContent = '✓ Using: ' + pu.name;
    } else if (btn) {
      btn.style.borderColor = '';
      var info = game.powerUpFor(game.getCurrentHider());
      btn.querySelector('b').textContent = 'Use Power-Up: ' + info.name;
    }
    AudioMan.click();
  }

  /* ---------- Privacy pass ---------- */
  function showPrivacy(nextPlayer, seeker, msg) {
    $('privacy-msg').textContent = msg;
    var nameCard = $('privacy-name-card');
    if (nextPlayer) {
      nameCard.innerHTML = avatarEmoji(nextPlayer.avatarId) + ' ' + esc(nextPlayer.name);
      $('privacy-title').textContent = 'Pass the device to the next player!';
      nameCard.setAttribute('data-next', 'hider');
    } else {
      nameCard.innerHTML = '🔍 ' + esc(seeker.name);
      $('privacy-title').textContent = 'Pass the device to the Seeker!';
      nameCard.setAttribute('data-next', 'seeker');
    }
    nameCard.setAttribute('data-name', nextPlayer ? nextPlayer.name : (seeker ? seeker.name : ''));
    show('screen-privacy');
  }

  function onPrivacyReady() {
    var nc = $('privacy-name-card');
    var next = nc.getAttribute('data-next');
    AudioMan.click();
    if (next === 'seeker') goSeekPhase();
    else goHideTurn();
  }

  /* ---------- Seeker turn ---------- */
  function goSeekPhase() {
    if (!game) return;
    var state = game.getState();
    if (state.phase === 'round-end') { goRoundResults(); return; }
    if (state.phase === 'champion') { goChampion(); return; }
    game.beginTargetSearch();
    renderSeekTurn();
  }

  function renderSeekTurn() {
    var state = game.getState();
    var st = game.getSeekerSearchState();
    var seeker = playerById(state, state.currentSeekerId);
    renderTopbar($('topbar-seek'), seeker, 'seeker', state, st);

    var banner = '🔍 <b>' + esc(seeker.name) + '</b> is searching for <b>' + esc(st.target.name) + '</b>!';
    banner += '<span class="banner-sub">Tap a spot to search. Guesses left: ' + st.guessesLeft + ' of ' + st.guessesTotal + ' · Hiders left: ' + st.hidersRemaining + '</span>';
    if (st.autoClue) banner += '<span class="clue-box">🤖 Clue: ' + esc(st.autoClue) + '</span>';
    if (st.powerUp && !st.powerUp.used) {
      banner += '<br><button class="btn btn-small" data-action="use-seeker-power" style="margin-top:8px">⚡ Use Power-Up: ' + st.powerUp.emoji + ' ' + esc(st.powerUp.name) + '</button>';
    }
    $('seek-banner').innerHTML = banner;
    $('seek-banner').querySelectorAll('[data-action]').forEach(function (b) {
      b.addEventListener('click', function () { modalAction(b.getAttribute('data-action')); });
    });

    U.pendingSpot = null;
    U.pendingPowerUp = null;
    renderMap($('map-seek'), 'seek');
    show('screen-seek');
  }

  function handleSeekMapClick(e) {
    var spotEl = e.target.closest ? e.target.closest('.spot') : null;
    if (!spotEl || !game) return;
    var spotId = spotEl.getAttribute('data-spot');
    var state = game.getState();
    if (state.phase !== 'seeker') return;
    var st = game.getSeekerSearchState();

    if (state.activeSpots.indexOf(spotId) === -1) {
      AudioMan.wrong();
      showModal(
        '<div class="modal-emoji">🏙️</div>' +
        '<div class="modal-title">Not a hiding place</div>' +
        '<div class="modal-text">Nobody can hide there. Look for the glowing spots!</div>' +
        '<div class="modal-buttons"><button class="btn btn-primary" data-action="close-modal">OK</button></div>'
      );
      return;
    }
    if (st.decoySpots.indexOf(spotId) !== -1) {
      AudioMan.decoy();
      showModal(
        '<div class="modal-emoji">✨</div>' +
        '<div class="modal-title">Just a hologram!</div>' +
        '<div class="modal-text">It was a Hologram Decoy — nobody was there. No guess lost!</div>' +
        '<div class="modal-buttons"><button class="btn btn-primary" data-action="close-modal">Keep Searching</button></div>'
      );
      return;
    }
    var loc = spotById(spotId);
    U.pendingSpot = spotId;
    renderMap($('map-seek'), 'seek');
    AudioMan.select();
    showModal(
      '<div class="modal-emoji">🔍</div>' +
      '<div class="modal-title">Search here?</div>' +
      '<div class="modal-text big">' + esc(loc.name) + '</div>' +
      '<div class="modal-buttons">' +
      '<button class="btn btn-primary" data-action="do-search">Search Here 🔍</button>' +
      '<button class="btn btn-secondary" data-action="cancel-search">Choose Another</button>' +
      '</div>'
    );
  }

  function doSearch() {
    var spotId = U.pendingSpot;
    if (!spotId || !game) return;
    var res = game.searchSpot(spotId);
    if (!res.ok) { hideModal(); return; }
    hideModal();

    if (res.found) {
      AudioMan.found();
      var ptsLine = '<div class="points-line">⭐ +' + res.seekerPoints + ' for the Seeker</div>';
      if (res.hiderPoints > 0) ptsLine += '<div class="points-line green">🙈 +' + res.hiderPoints + ' bonus for ' + esc(res.hider.name) + '</div>';
      showModal(
        '<div class="modal-emoji">🎉</div>' +
        '<div class="modal-title">Found You!</div>' +
        '<div class="modal-text big">' + avatarEmoji(res.hider.avatarId) + ' <b>' + esc(res.hider.name) + '</b> was hiding ' + esc(res.spot.name) + '!</div>' +
        '<div class="modal-text">Found on guess ' + res.guess + '.</div>' + ptsLine +
        '<div class="modal-buttons"><button class="btn btn-primary" data-action="continue-after-result">Continue ▶</button></div>'
      );
      flashSpot($('map-seek'), spotId, 'found');
      Confetti.launch(70);
      return;
    }

    if (res.escaped) {
      AudioMan.escape();
      showModal(
        '<div class="modal-emoji">🏃</div>' +
        '<div class="modal-title">The Hider escaped this round!</div>' +
        '<div class="modal-text big">' + avatarEmoji(res.hider.avatarId) + ' <b>' + esc(res.hider.name) + '</b> was hiding ' + esc(res.revealSpot.name) + '!</div>' +
        '<div class="points-line green">🙈 +100 for ' + esc(res.hider.name) + '</div>' +
        '<div class="modal-buttons"><button class="btn btn-primary" data-action="continue-after-result">Continue ▶</button></div>'
      );
      flashSpot($('map-seek'), spotId, 'found');
      return;
    }

    if (res.notHidingSpot) {
      AudioMan.wrong();
      showModal(
        '<div class="modal-emoji">🏙️</div>' +
        '<div class="modal-title">Not a hiding place</div>' +
        '<div class="modal-text">Nobody can hide there. No guess lost!</div>' +
        '<div class="modal-buttons"><button class="btn btn-primary" data-action="close-modal">OK</button></div>'
      );
      return;
    }

    // wrong guess
    AudioMan.wrong();
    var left = res.guessesLeft;
    var guessWord = left === 1 ? 'Final Guess!' : left + ' guesses left.';
    showModal(
      '<div class="modal-emoji">🙅</div>' +
      '<div class="modal-title">Nobody is hiding here!</div>' +
      '<div class="modal-text">' + guessWord + '</div>' +
      '<div class="modal-buttons"><button class="btn btn-primary" data-action="close-modal">Keep Searching 🔍</button></div>'
    );
  }

  function flashSpot(container, spotId, cls) {
    var el = container.querySelector('.spot[data-spot="' + spotId + '"]');
    if (el) {
      el.classList.add(cls);
      setTimeout(function () { el.classList.remove(cls); }, 2600);
    }
  }

  function continueAfterResult() {
    hideModal();
    var state = game.getState();
    if (state.phase === 'seeker') { renderSeekTurn(); }
    else if (state.phase === 'round-end') { goRoundResults(); }
    else if (state.phase === 'champion') { goChampion(); }
  }

  function useSeekerPower() {
    var st = game.getSeekerSearchState();
    if (!st || !st.powerUp || st.powerUp.used) return;
    var pu = st.powerUp;
    showModal(
      '<div class="modal-emoji">' + pu.emoji + '</div>' +
      '<div class="modal-title">' + esc(pu.name) + '</div>' +
      '<div class="modal-text">' + esc(pu.desc) + '</div>' +
      '<div class="modal-buttons">' +
      '<button class="btn btn-primary" data-action="confirm-use-power">Use It ⚡</button>' +
      '<button class="btn btn-secondary" data-action="close-modal">Not Now</button>' +
      '</div>'
    );
  }

  function confirmUsePower() {
    var st = game.getSeekerSearchState();
    if (!st || !st.powerUp) { hideModal(); return; }
    var id = st.powerUp.id;
    var res = game.useSeekerPowerUp(id);
    hideModal();
    if (!res.ok) return;
    if (id === 'scanner') {
      AudioMan.scan();
      renderSeekTurn();
      showModal(
        '<div class="modal-emoji">📡</div>' +
        '<div class="modal-title">Scanner Pulse!</div>' +
        '<div class="modal-text">One of the <b>white glowing spots</b> hides ' + esc(st.target.name) + '… but which?</div>' +
        '<div class="modal-buttons"><button class="btn btn-primary" data-action="close-modal">Study the Map 🧐</button></div>'
      );
    } else if (id === 'clue') {
      AudioMan.select();
      renderSeekTurn();
      showModal(
        '<div class="modal-emoji">🤖</div>' +
        '<div class="modal-title">Robot Clue!</div>' +
        '<div class="modal-text big">“' + esc(res.clue) + '”</div>' +
        '<div class="modal-buttons"><button class="btn btn-primary" data-action="close-modal">Thanks, Robot!</button></div>'
      );
    } else if (id === 'extra-guess') {
      AudioMan.found();
      renderSeekTurn();
      showModal(
        '<div class="modal-emoji">➕</div>' +
        '<div class="modal-title">Extra Guess!</div>' +
        '<div class="modal-text">You gained 1 extra guess for this Hider. Use it well!</div>' +
        '<div class="modal-buttons"><button class="btn btn-primary" data-action="close-modal">Keep Searching 🔍</button></div>'
      );
    }
  }

  /* ---------- Round results ---------- */
  function goRoundResults() {
    AudioMan.round();
    var summary = game.getRoundSummary();
    var state = game.getState();
    $('results-title').textContent = 'Round ' + summary.round + ' Complete!';

    var foundHtml = summary.found.length
      ? summary.found.map(function (f) {
          return '<div class="result-item"><span class="r-avatar">' + avatarEmoji(f.player.avatarId) + '</span>' +
            '<span class="r-name">' + esc(f.player.name) + '</span>' +
            '<span class="r-note">found in ' + f.spot.name + ' · guess ' + f.guess + '</span></div>';
        }).join('')
      : '<p class="muted">Nobody was found!</p>';

    var escapedHtml = summary.escaped.length
      ? summary.escaped.map(function (f) {
          return '<div class="result-item"><span class="r-avatar">' + avatarEmoji(f.player.avatarId) + '</span>' +
            '<span class="r-name">' + esc(f.player.name) + '</span>' +
            '<span class="r-note">escaped from ' + f.spot.name + '!</span></div>';
        }).join('')
      : '<p class="muted">Nobody escaped!</p>';

    var lbHtml = summary.leaderboard.map(function (p, i) {
      return '<div class="lb-row' + (p.id === state.currentSeekerId ? ' lb-me' : '') + '">' +
        '<span class="lb-rank">' + (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1)) + '</span>' +
        '<span class="lb-avatar">' + avatarEmoji(p.avatarId) + '</span>' +
        '<span class="lb-name">' + esc(p.name) + '</span>' +
        '<span class="lb-score">' + p.score + '</span></div>';
    }).join('');

    $('results-body').innerHTML =
      '<div class="results-grid">' +
      '<div class="result-card found"><h3>🔍 Found</h3>' + foundHtml + '</div>' +
      '<div class="result-card escaped"><h3>🏃 Escaped</h3>' + escapedHtml + '</div>' +
      '</div>' +
      '<div class="result-card leaderboard-card"><h3>⭐ Round Points</h3>' +
      '<div class="result-item"><span class="r-avatar">🔍</span><span class="r-name">' + esc(summary.seeker.name) + ' (Seeker)</span><span class="r-note" style="color:var(--yellow)">+' + summary.seekerPoints + '</span></div>' +
      '<div class="result-item"><span class="r-avatar">🙈</span><span class="r-name">Hiders together</span><span class="r-note" style="color:var(--green)">+' + summary.hiderPoints + '</span></div>' +
      '</div>' +
      '<div class="result-card leaderboard-card"><h3>🏆 Leaderboard</h3>' + lbHtml + '</div>';

    var isLast = state.round >= state.roundTotal;
    $('btn-next-round').textContent = isLast ? 'See the Champion 🏆' : 'Next Round ▶';
    show('screen-round-results');
  }

  function nextRound() {
    AudioMan.click();
    var res = game.nextRound();
    if (res.gameOver) goChampion();
    else goHideTurn();
  }

  /* ---------- Champion ---------- */
  function goChampion() {
    AudioMan.stopMusic();
    AudioMan.victory();
    var winner = game.getWinner();
    var lb = game.getLeaderboard();
    $('champ-name').innerHTML = avatarEmoji(winner.avatarId) + ' <b>' + esc(winner.name) + '</b>';

    var lbHtml = lb.map(function (p, i) {
      return '<div class="lb-row' + (p.id === winner.id ? ' lb-me' : '') + '">' +
        '<span class="lb-rank">' + (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1)) + '</span>' +
        '<span class="lb-avatar">' + avatarEmoji(p.avatarId) + '</span>' +
        '<span class="lb-name">' + esc(p.name) + '</span>' +
        '<span class="lb-score">' + p.score + '</span></div>';
    }).join('');
    $('champ-leaderboard').innerHTML = '<div class="result-card leaderboard-card"><h3>🏆 Final Leaderboard</h3>' + lbHtml + '</div>';

    // save champion
    var champs = lsGet(LS_CHAMPS, []);
    champs.push({ name: winner.name, score: winner.score, date: new Date().toLocaleDateString() });
    champs.sort(function (a, b) { return b.score - a.score; });
    lsSet(LS_CHAMPS, champs.slice(0, 10));

    show('screen-champion');
    Confetti.launch(180);
  }

  function playAgain() {
    AudioMan.click();
    var res = game.resetGame();
    if (res.ok) {
      if (settings.musicOn) AudioMan.startMusic();
      goHideTurn();
    }
  }

  function goMenu() {
    AudioMan.stopMusic();
    game = null;
    U.pendingSpot = null;
    U.pendingPowerUp = null;
    renderMenu();
    show('screen-menu');
  }

  /* ======================= Central action router ======================= */
  function modalAction(action) {
    switch (action) {
      case 'close-modal': hideModal(); break;
      case 'confirm-hide': confirmHide(); break;
      case 'cancel-hide': hideModal(); U.pendingSpot = null; U.pendingPowerUp = null; renderMap($('map-hide'), 'hide'); break;
      case 'toggle-hider-power': toggleHiderPower(); break;
      case 'cancel-search': hideModal(); U.pendingSpot = null; renderMap($('map-seek'), 'seek'); break;
      case 'do-search': doSearch(); break;
      case 'continue-after-result': continueAfterResult(); break;
      case 'use-seeker-power': useSeekerPower(); break;
      case 'confirm-use-power': confirmUsePower(); break;
      case 'toggle-music':
        settings.musicOn = !settings.musicOn;
        lsSet(LS_SETTINGS, settings);
        updateAudioGains();
        AudioMan.click();
        renderTopbars();
        refreshAudioUI();
        break;
      case 'toggle-sfx':
        settings.sfxOn = !settings.sfxOn;
        lsSet(LS_SETTINGS, settings);
        updateAudioGains();
        AudioMan.click();
        renderTopbars();
        refreshAudioUI();
        break;
    }
  }
  function renderTopbars() {
    var state = game ? game.getState() : null;
    if (!game) return;
    if (state.phase === 'hider') {
      var p = playerById(state, game.getCurrentHider());
      if (p) renderTopbar($('topbar-hide'), p, 'hider', state);
    } else if (state.phase === 'seeker') {
      var p2 = playerById(state, state.currentSeekerId);
      if (p2) renderTopbar($('topbar-seek'), p2, 'seeker', state, game.getSeekerSearchState());
    }
  }

  /* ======================= Boot / event wiring ======================= */
  function bind(id, fn) { $(id).addEventListener('click', fn); }

  function init() {
    // menu
    bind('btn-menu-start', function () {
      AudioMan.ensure(); AudioMan.click();
      initSetup();
      show('screen-setup');
    });
    bind('btn-menu-howto', function () { AudioMan.ensure(); AudioMan.click(); show('screen-howto'); });
    bind('btn-howto-back', function () { AudioMan.click(); show('screen-menu'); });
    bind('btn-toggle-music', function () {
      AudioMan.ensure();
      settings.musicOn = !settings.musicOn;
      lsSet(LS_SETTINGS, settings);
      updateAudioGains();
      AudioMan.click();
      refreshAudioUI();
      if (settings.musicOn && game) AudioMan.startMusic();
    });
    bind('btn-toggle-sfx', function () {
      AudioMan.ensure();
      settings.sfxOn = !settings.sfxOn;
      lsSet(LS_SETTINGS, settings);
      updateAudioGains();
      AudioMan.click();
      refreshAudioUI();
    });
    bind('volume-slider', function () {}); // (range input is handled via 'input' below)
    $('volume-slider').addEventListener('input', function (e) {
      settings.volume = parseInt(e.target.value, 10);
      lsSet(LS_SETTINGS, settings);
      updateAudioGains();
    });

    // setup
    document.querySelectorAll('#count-row .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        setupPlayers = parseInt(c.dataset.count, 10);
        initSetup();
        AudioMan.click();
      });
    });
    document.querySelectorAll('#diff-row .diff-card').forEach(function (c) {
      c.addEventListener('click', function () {
        setupDifficulty = c.dataset.diff;
        renderSetup();
        AudioMan.click();
      });
    });
    bind('btn-setup-back', function () { AudioMan.click(); show('screen-menu'); });
    bind('btn-setup-start', function () {
      AudioMan.ensure(); AudioMan.click();
      startGame();
    });

    // tutorial
    bind('btn-tut-skip', function () {
      AudioMan.click();
      tutorialSeen = true;
      lsSet(LS_TUTORIAL, true);
      goHideTurn();
    });
    bind('btn-tut-back', function () {
      if (tutorialStep > 0) { tutorialStep--; renderTutorial(); }
      AudioMan.click();
    });
    bind('btn-tut-next', function () {
      AudioMan.click();
      if (tutorialStep < TUTORIAL.length - 1) { tutorialStep++; renderTutorial(); }
      else finishTutorial();
    });

    // privacy
    bind('btn-privacy-ready', onPrivacyReady);

    // round results
    bind('btn-next-round', nextRound);

    // champion
    bind('btn-play-again', playAgain);
    bind('btn-main-menu', goMenu);

    // maps
    $('map-hide').addEventListener('click', handleHideMapClick);
    $('map-seek').addEventListener('click', handleSeekMapClick);

    // close modal on backdrop click
    modalRoot.addEventListener('click', function (e) {
      if (e.target === modalRoot) hideModal();
    });

    renderMenu();
    show('screen-menu');
  }

  // expose a small API for automated DOM tests
  window.FHSUI = {
    init: init,
    get game() { return game; },
    show: show,
    showModal: showModal,
    hideModal: hideModal,
    startGame: startGame,
    goHideTurn: goHideTurn,
    goSeekPhase: goSeekPhase,
    goRoundResults: goRoundResults,
    goChampion: goChampion,
    confirmHide: confirmHide,
    doSearch: doSearch,
    nextRound: nextRound,
    setSetup: function (count, diff, data) {
      setupPlayers = count; setupDifficulty = diff; setupData = data;
      renderSetup();
    }
  };

  init();
})();

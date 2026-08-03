/* ============================================================================
 * Future Hide & Seek — FPS Seeker Engine (first-person 3D)
 * ----------------------------------------------------------------------------
 * Builds the Neon Future City in 3D (THREE.js), gives the Seeker a first-person
 * camera with WASD/mouse (desktop) and touch joystick (mobile), and turns
 * searching into aiming + scanning objects.
 *
 * NO WEAPONS — the Seeker uses a friendly scanner device. Safe for kids.
 *
 * The game RULES stay in game-core.js; this file only reports "scanned spotId"
 * back through the onScan callback.
 * ========================================================================== */
(function (root) {
  'use strict';

  /* r128 vendored build exposes global THREE */
  if (!root.THREE) { console.warn('FPS engine requires three.min.js'); return; }
  var THREE = root.THREE;

  var NEON = {
    blue: 0x4cc9f0, purple: 0xc77dff, green: 0x3dffa0,
    orange: 0xffb648, pink: 0xff7ad9, cyan: 0x00f0ff
  };

  /* Map 2D city coords (SVG 1000x640) into the 3D world */
  function wx(locX) { return (locX - 500) * 0.09; }
  function wz(locY) { return (locY - 315) * 0.09; }

  var WORLD = { halfX: 47, halfZ: 29, playerR: 0.55 };

  /* Perimeter buildings (kept clear of spot pedestals) */
  var BUILDINGS = [
    { x: -46, z: -26, w: 6, d: 10, h: 13 }, { x: -46, z: -4, w: 6, d: 12, h: 9 },
    { x: -46, z: 18, w: 6, d: 10, h: 15 }, { x: 46, z: -26, w: 6, d: 10, h: 11 },
    { x: 46, z: -4, w: 6, d: 12, h: 16 }, { x: 46, z: 18, w: 6, d: 10, h: 10 },
    { x: -30, z: -28, w: 12, d: 6, h: 8 }, { x: 0, z: -28, w: 14, d: 6, h: 12 },
    { x: 30, z: -28, w: 12, d: 6, h: 9 }, { x: -32, z: 28, w: 12, d: 6, h: 10 },
    { x: 0, z: 28, w: 16, d: 6, h: 14 }, { x: 32, z: 28, w: 12, d: 6, h: 8 },
    { x: -44, z: -44, w: 9, d: 9, h: 20 }, { x: 44, z: -42, w: 8, d: 8, h: 24 },
    { x: -44, z: 42, w: 8, d: 8, h: 18 }, { x: 44, z: 42, w: 9, d: 9, h: 22 }
  ];

  function makeTextSprite(text, opts) {
    opts = opts || {};
    var canvas = document.createElement('canvas');
    var scale = opts.scale || 1;
    canvas.width = Math.max(64, Math.ceil((text.length * 34 + 40) * scale));
    canvas.height = Math.ceil(96 * scale);
    var ctx = canvas.getContext('2d');
    ctx.font = '700 ' + Math.round(64 * scale) + 'px Fredoka, "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (opts.bg) {
      ctx.fillStyle = 'rgba(8,12,40,0.85)';
      roundRect(ctx, 6, 6, canvas.width - 12, canvas.height - 12, 18);
      ctx.fill();
      ctx.strokeStyle = opts.stroke || '#00f0ff';
      ctx.lineWidth = 3;
      roundRect(ctx, 6, 6, canvas.width - 12, canvas.height - 12, 18);
      ctx.stroke();
    }
    ctx.fillStyle = opts.color || '#ffffff';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    var tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    var sprite = new THREE.Sprite(mat);
    // keep sprite a sensible size regardless of canvas aspect
    var sh = opts.spriteHeight || 2.2;
    sprite.scale.set(canvas.width / canvas.height * sh * 0.5, sh, 1);
    return sprite;
  }

  function makeEmojiSprite(emoji, hex) {
    var canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    var ctx = canvas.getContext('2d');
    ctx.font = '76px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 64);
    var tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    var mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false,
      opacity: 1
    });
    var sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.0, 2.0, 1);
    return sprite;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function FPSWorld(container, opts) {
    opts = opts || {};
    this.container = container;
    this.spots = opts.spots || [];
    this.onScan = opts.onScan || function () {};
    this.debug = !!opts.debug;

    this.aimedId = null;
    this.activeSet = new Set(opts.activeIds || []);
    this.hintSet = new Set(opts.hints || []);
    this.decoySet = new Set(opts.decoys || []);
    this.scannerSet = new Set(opts.scanner || []);
    this.revealedId = null;

    this.keys = {};
    this.yaw = Math.PI;          // face roughly -z (toward the city centre)
    this.pitch = -0.08;
    this.locked = false;
    this.moveVec = { x: 0, y: 0 };
    this.joyOrigin = null;
    this.joyId = null;
    this.joyVec = { x: 0, y: 0 };
    this.lookTouchId = null;
    this.lookLast = null;
    this.raf = 0;
    this.clock = new THREE.Clock();
    this.hitMeshes = [];
    this.spotData = {};          // id -> {group, ring, ringMat, glow, label, beam}
    this.bounds = [];

    this._build();
    this._bind();
    this._loop();
  }

  FPSWorld.prototype._build = function () {
    var c = this.container;
    var cw = c.clientWidth || 800;      // fallback if created while hidden
    var ch = c.clientHeight || 512;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(cw, ch);
    c.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e2a);
    this.scene.fog = new THREE.Fog(0x0a0e2a, 60, 150);

    this.camera = new THREE.PerspectiveCamera(70, cw / ch, 0.1, 300);
    this.pos = new THREE.Vector3(0, 1.7, 24);
    this.camera.position.copy(this.pos);

    // lights
    this.scene.add(new THREE.AmbientLight(0x5566aa, 0.65));
    var hemi = new THREE.HemisphereLight(0x8a7bff, 0x1a1440, 0.7);
    this.scene.add(hemi);
    var sun = new THREE.DirectionalLight(0x9adfff, 0.75);
    sun.position.set(20, 40, 10);
    this.scene.add(sun);

    // ground
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.halfX * 2 + 12, WORLD.halfZ * 2 + 12),
      new THREE.MeshLambertMaterial({ color: 0x0d1230 })
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    var grid = new THREE.GridHelper(116, 58, 0x2a3a7e, 0x1b2350);
    grid.position.y = 0.02;
    this.scene.add(grid);

    // roads
    var roadMat = new THREE.MeshLambertMaterial({ color: 0x0a0e26 });
    var roadH = new THREE.Mesh(new THREE.PlaneGeometry(110, 4), roadMat);
    roadH.rotation.x = -Math.PI / 2; roadH.position.set(0, 0.03, -4);
    this.scene.add(roadH);
    var roadV = new THREE.Mesh(new THREE.PlaneGeometry(4, 62), roadMat);
    roadV.rotation.x = -Math.PI / 2; roadV.position.set(6, 0.03, 0);
    this.scene.add(roadV);
    var dashMat = new THREE.MeshBasicMaterial({ color: 0x2e3f7d });
    for (var dx = -52; dx <= 52; dx += 8) {
      var dash = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.3), dashMat);
      dash.rotation.x = -Math.PI / 2; dash.position.set(dx, 0.05, -4);
      this.scene.add(dash);
    }
    for (var dz = -26; dz <= 26; dz += 8) {
      var dash2 = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 3), dashMat);
      dash2.rotation.x = -Math.PI / 2; dash2.position.set(6, 0.05, dz);
      this.scene.add(dash2);
    }

    // buildings
    BUILDINGS.forEach(function (b) {
      var mesh = new THREE.Mesh(
        new THREE.BoxGeometry(b.w, b.h, b.d),
        new THREE.MeshLambertMaterial({ color: 0x171543 })
      );
      mesh.position.set(b.x, b.h / 2, b.z);
      this.scene.add(mesh);
      this.bounds.push({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2 });
      // neon roof strip
      var strip = new THREE.Mesh(
        new THREE.BoxGeometry(b.w + 0.2, 0.25, b.d + 0.2),
        new THREE.MeshBasicMaterial({ color: [0x00f0ff, 0xc77dff, 0x3dffa0, 0xff7ad9][b.x % 4 < 0 ? 0 : (Math.abs(b.x) + b.h) % 4] })
      );
      strip.position.set(b.x, b.h + 0.15, b.z);
      this.scene.add(strip);
    }, this);

    // moon + stars
    var moon = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xdfe4ff, fog: false }));
    moon.position.set(48, 55, -70);
    this.scene.add(moon);
    var starGeo = new THREE.BufferGeometry();
    var starPos = [];
    for (var s = 0; s < 220; s++) {
      starPos.push((Math.random() - 0.5) * 240, 25 + Math.random() * 80, -40 - Math.random() * 160);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xcfd6ff, size: 0.6, sizeAttenuation: false, transparent: true, opacity: 0.7, fog: false
    })));

    // neon signs
    var sign1 = makeTextSprite('NEON CITY', { bg: true, stroke: '#00f0ff', color: '#00f0ff', scale: 1.6, spriteHeight: 2.8 });
    sign1.position.set(-16, 8, -24);
    this.scene.add(sign1);
    var sign2 = makeTextSprite('HOLO MALL', { bg: true, stroke: '#c77dff', color: '#c77dff', scale: 1.1, spriteHeight: 2.4 });
    sign2.position.set(22, 6, -22);
    this.scene.add(sign2);
    var sign3 = makeTextSprite('SPACE DOCK', { bg: true, stroke: '#ff7ad9', color: '#ff7ad9', scale: 1.1, spriteHeight: 2.4 });
    sign3.position.set(-30, 6, 20);
    this.scene.add(sign3);

    // hiding spots -> 3D objects
    this.spots.forEach(function (loc) {
      var x = wx(loc.x), z = wz(loc.y);
      var hex = NEON[loc.color] || 0x00f0ff;
      var group = new THREE.Group();
      group.position.set(x, 0, z);

      // pedestal
      var ped = new THREE.Mesh(
        new THREE.CylinderGeometry(1.45, 1.6, 0.5, 20),
        new THREE.MeshLambertMaterial({ color: 0x141a3e })
      );
      ped.position.y = 0.25;
      group.add(ped);
      // neon base ring
      var baseRing = new THREE.Mesh(
        new THREE.RingGeometry(1.2, 1.45, 24),
        new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
      );
      baseRing.rotation.x = -Math.PI / 2;
      baseRing.position.y = 0.52;
      group.add(baseRing);
      // hologram column
      var holo = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, 1.9, 16, 1, true),
        new THREE.MeshLambertMaterial({ color: hex, transparent: true, opacity: 0.32, emissive: hex, emissiveIntensity: 0.35 })
      );
      holo.position.y = 1.35;
      group.add(holo);
      // emoji sprite
      var emoji = makeEmojiSprite(loc.emoji, hex);
      emoji.position.y = 2.5;
      group.add(emoji);
      // name label (shown when aimed)
      var label = makeTextSprite(loc.name, { bg: true, stroke: '#00f0ff', scale: 0.85 });
      label.position.y = 3.9;
      label.visible = false;
      group.add(label);
      // aim/shimmer ring (floating above holo)
      var ring = new THREE.Mesh(
        new THREE.RingGeometry(0.95, 1.25, 28),
        new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 2.55;
      group.add(ring);
      this.spotData[loc.id] = { group: group, ring: ring, hex: hex, label: label, emoji: emoji, pulse: 0 };

      // invisible raycast target
      var hit = new THREE.Mesh(
        new THREE.SphereGeometry(2.1, 8, 6),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      hit.position.set(x, 1.6, z);
      this.scene.add(hit);
      hit.userData.spotId = loc.id;
      this.hitMeshes.push(hit);

      this.scene.add(group);
    }, this);

    // minimap
    var mm = document.createElement('canvas');
    mm.width = 92; mm.height = 92;
    mm.className = 'fps-minimap';
    c.appendChild(mm);
    this.minimap = mm;
    this.minimapCtx = mm.getContext('2d');

    // resize
    this._onResize = this._resize.bind(this);
    window.addEventListener('resize', this._onResize);
  };

  FPSWorld.prototype._resize = function () {
    var w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  FPSWorld.prototype._bind = function () {
    var self = this;

    this._onKeyDown = function (e) { self.keys[e.code] = true; };
    this._onKeyUp = function (e) { self.keys[e.code] = false; };
    this._onMouseMove = function (e) {
      if (!self.locked) return;
      self.yaw -= e.movementX * 0.0026;
      self.pitch -= e.movementY * 0.0026;
      self.pitch = Math.max(-1.45, Math.min(1.45, self.pitch));
    };
    this._onLockChange = function () {
      self.locked = document.pointerLockElement === self.canvas;
    };
    this._onCanvasClick = function () {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
      if (self.canvas.requestPointerLock) self.canvas.requestPointerLock();
    };
    this._onKeyScan = function (e) {
      if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') {
        var modal = document.getElementById('modal-root');
        if (modal && !modal.hidden) return;         // don't scan under an open modal
        if (self.container.offsetParent !== null) { e.preventDefault(); self.scanNow(); }
      }
    };
    this._onTouchStart = function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        var half = window.innerWidth / 2;
        if (t.clientX < half) {
          if (self.joyId === null) {
            self.joyId = t.identifier;
            self.joyOrigin = { x: t.clientX, y: t.clientY };
            self.joyVec = { x: 0, y: 0 };
            var js = self.container.querySelector('.fps-joystick');
            if (js) { js.style.display = 'block'; js.style.left = t.clientX + 'px'; js.style.top = t.clientY + 'px'; }
          }
        } else if (self.lookTouchId === null) {
          self.lookTouchId = t.identifier;
          self.lookLast = { x: t.clientX, y: t.clientY };
        }
      }
    };
    this._onTouchMove = function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier === self.joyId && self.joyOrigin) {
          var dx = t.clientX - self.joyOrigin.x, dy = t.clientY - self.joyOrigin.y;
          var len = Math.sqrt(dx * dx + dy * dy);
          var max = 46;
          if (len > max) { dx *= max / len; dy *= max / len; len = max; }
          self.joyVec.x = dx / max; self.joyVec.y = dy / max;
          var js = self.container.querySelector('.fps-joystick');
          if (js) { js.style.left = (self.joyOrigin.x + dx) + 'px'; js.style.top = (self.joyOrigin.y + dy) + 'px'; }
        } else if (t.identifier === self.lookTouchId && self.lookLast) {
          self.yaw -= (t.clientX - self.lookLast.x) * 0.006;
          self.pitch -= (t.clientY - self.lookLast.y) * 0.006;
          self.pitch = Math.max(-1.45, Math.min(1.45, self.pitch));
          self.lookLast = { x: t.clientX, y: t.clientY };
        }
      }
    };
    this._onTouchEnd = function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier === self.joyId) {
          self.joyId = null; self.joyOrigin = null; self.joyVec = { x: 0, y: 0 };
          var js = self.container.querySelector('.fps-joystick');
          if (js) js.style.display = 'none';
        }
        if (t.identifier === self.lookTouchId) { self.lookTouchId = null; self.lookLast = null; }
      }
    };

    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('touchstart', this._onTouchStart, { passive: true });
    document.addEventListener('touchmove', this._onTouchMove, { passive: true });
    document.addEventListener('touchend', this._onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', this._onTouchEnd, { passive: true });
    document.addEventListener('keydown', this._onKeyScan);
    this.canvas.addEventListener('click', this._onCanvasClick);
  };

  FPSWorld.prototype._collide = function (x, z) {
    var r = WORLD.playerR;
    var nx = Math.max(-WORLD.halfX + r, Math.min(WORLD.halfX - r, x));
    var nz = Math.max(-WORLD.halfZ + r, Math.min(WORLD.halfZ - r, z));
    x = nx; z = nz;
    for (var i = 0; i < this.bounds.length; i++) {
      var b = this.bounds[i];
      var cx = Math.max(b.minX, Math.min(b.maxX, x));
      var cz = Math.max(b.minZ, Math.min(b.maxZ, z));
      var dx = x - cx, dz = z - cz;
      var d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (cx === b.minX || cx === b.maxX) x = cx > x ? b.minX - r : b.maxX + r;
        if (cz === b.minZ || cz === b.maxZ) z = cz > z ? b.minZ - r : b.maxZ + r;
      }
    }
    var self = this;
    this.spots.forEach(function (loc) {
      var sx = wx(loc.x), sz = wz(loc.y);
      var dxs = x - sx, dzs = z - sz;
      var dr = 1.7 + r;
      if (dxs * dxs + dzs * dzs < dr * dr) {
        var d = Math.sqrt(dxs * dxs + dzs * dzs) || 0.0001;
        x = sx + dxs / d * dr;
        z = sz + dzs / d * dr;
      }
    });
    return { x: x, z: z };
  };

  FPSWorld.prototype._update = function (dt) {
    var k = this.keys;
    var f = 0, s = 0;
    if (k['KeyW'] || k['ArrowUp']) f += 1;
    if (k['KeyS'] || k['ArrowDown']) f -= 1;
    if (k['KeyA'] || k['ArrowLeft']) s -= 1;
    if (k['KeyD'] || k['ArrowRight']) s += 1;
    if (this.joyVec.x !== 0 || this.joyVec.y !== 0) {
      s += this.joyVec.x;
      f -= this.joyVec.y;
    }
    var len = Math.sqrt(f * f + s * s);
    if (len > 0) {
      f /= len; s /= len;
      var speed = 8.5;
      var fx = -Math.sin(this.yaw) * f + Math.cos(this.yaw) * s;
      var fz = -Math.cos(this.yaw) * f - Math.sin(this.yaw) * s;
      var np = this._collide(this.pos.x + fx * speed * dt, this.pos.z + fz * speed * dt);
      this.pos.x = np.x; this.pos.z = np.z;
    }
    this.camera.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  };

  FPSWorld.prototype._aim = function () {
    var raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    var hits = raycaster.intersectObjects(this.hitMeshes, false);
    var id = null;
    if (hits.length && hits[0].distance < 16) {
      id = hits[0].object.userData.spotId || null;
    }
    return id;
  };

  FPSWorld.prototype._tick = function () {
    var self = this;
    var dt = Math.min(this.clock.getDelta(), 0.05);
    var active = this.container.offsetParent !== null;
    if (active) {
      this._update(dt);
      this.aimedId = this._aim();
      this._pulse(dt);
      this._drawMinimap();
      try { this.renderer.render(this.scene, this.camera); } catch (e) { /* keep loop alive */ }
    }
    this.raf = requestAnimationFrame(function () { self._tick(); });
  };
  FPSWorld.prototype._loop = function () { this._tick(); };

  FPSWorld.prototype._pulse = function (dt) {
    var t = performance.now() / 1000;
    var self = this;
    Object.keys(this.spotData).forEach(function (id, idx) {
      var d = self.spotData[id];
      var active = self.activeSet.has(id);
      var hint = self.hintSet.has(id);
      var decoy = self.decoySet.has(id);
      var scan = self.scannerSet.has(id);
      var aimed = self.aimedId === id;
      var revealed = self.revealedId === id;

      var ring = d.ring;
      var opacity = 0;
      if (revealed) opacity = 0.95;
      else if (scan) opacity = 0.8 + 0.2 * Math.sin(t * 6);
      else if (hint) opacity = 0.4 + 0.35 * Math.sin(t * 4);
      else if (decoy) opacity = 0.4 + 0.35 * Math.sin(t * 9);
      else if (active) opacity = 0.22 + 0.14 * Math.sin(t * 2.2 + idx * 1.3);
      ring.material.opacity = Math.max(opacity, aimed ? 0.9 : 0);
      ring.material.color.setHex(revealed ? 0x3dffa0 : scan ? 0xffffff : aimed ? 0xffe45c : d.hex);
      ring.scale.setScalar(scan ? 1.35 : 1);
      d.label.visible = aimed || (self.debug && false);
      d.emoji.material.opacity = decoy ? 0.5 + 0.4 * Math.sin(t * 10) : 1;
    });
    var reticle = this.container.querySelector && this.container.querySelector('.fps-reticle');
    var aimLabel = this.container.querySelector && this.container.querySelector('.fps-aim-label');
    if (reticle) reticle.classList.toggle('hot', !!this.aimedId);
    if (aimLabel) {
      var name = '';
      if (this.aimedId) {
        var loc = this.spots.find(function (l) { return l.id === self.aimedId; });
        name = loc ? loc.name : '';
      }
      aimLabel.textContent = name;
    }
  };

  FPSWorld.prototype._drawMinimap = function () {
    var ctx = this.minimapCtx, mm = this.minimap;
    var size = mm.width;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(8,12,36,0.75)';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,240,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    var R = 44;
    var self = this;
    function px(wx2, wz2) { return { x: size / 2 + (wx2 / 96) * R, y: size / 2 + (wz2 / 96) * R }; }
    this.spots.forEach(function (loc) {
      var active = self.activeSet.has(loc.id);
      var hint = self.hintSet.has(loc.id);
      var decoy = self.decoySet.has(loc.id);
      var p = px(wx(loc.x), wz(loc.y));
      ctx.beginPath();
      ctx.arc(p.x, p.y, active ? 3 : 1.6, 0, Math.PI * 2);
      ctx.fillStyle = active ? (hint || decoy ? '#ffffff' : '#00f0ff') : 'rgba(255,255,255,0.25)';
      ctx.fill();
    });
    var pp = px(this.pos.x, this.pos.z);
    ctx.save();
    ctx.translate(pp.x, pp.y);
    ctx.rotate(-this.yaw);
    ctx.fillStyle = '#ffe45c';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  FPSWorld.prototype.scanNow = function () {
    if (this.aimedId) this.onScan(this.aimedId);
    else this.onScan(null);
  };

  FPSWorld.prototype.setState = function (state) {
    state = state || {};
    this.activeSet = new Set(state.activeIds || []);
    this.hintSet = new Set(state.hints || []);
    this.decoySet = new Set(state.decoys || []);
    this.scannerSet = new Set(state.scanner || []);
    this.revealedId = null;
    this.aimedId = null;
  };

  FPSWorld.prototype.revealSpot = function (id) {
    this.revealedId = id;
    var d = this.spotData[id];
    if (d) {
      // point the camera at it (nice reveal moment)
      var x = this.pos.x - d.group.position.x;
      var z = this.pos.z - d.group.position.z;
      this.yaw = Math.atan2(-x, -z);
      this.pitch = -0.15;
    }
  };

  /* --- test / accessibility hooks --- */
  FPSWorld.prototype.aimAtSpot = function (id) {
    var d = this.spotData[id];
    if (!d) return false;
    var dx = d.group.position.x - this.pos.x;
    var dz = d.group.position.z - this.pos.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 16) { this._walkToward(id, dist); }
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = -Math.atan2(1.7 - 2.2, dist || 1) + 0.15;
    this.aimedId = id;
    return true;
  };
  FPSWorld.prototype._walkToward = function (id, dist) {
    // teleport closer so tests can aim reliably
    var d = this.spotData[id];
    var tx = d.group.position.x, tz = d.group.position.z;
    var dx = tx - this.pos.x, dz = tz - this.pos.z;
    var l = Math.sqrt(dx * dx + dz * dz) || 1;
    this.pos.x = tx - dx / l * 5;
    this.pos.z = tz - dz / l * 5;
  };
  FPSWorld.prototype.getPos = function () {
    return { x: this.pos.x, z: this.pos.z, yaw: this.yaw };
  };
  FPSWorld.prototype.dispose = function () {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('touchstart', this._onTouchStart);
    document.removeEventListener('touchmove', this._onTouchMove);
    document.removeEventListener('touchend', this._onTouchEnd);
    document.removeEventListener('touchcancel', this._onTouchEnd);
    document.removeEventListener('keydown', this._onKeyScan);
    if (this.canvas) this.canvas.removeEventListener('click', this._onCanvasClick);
    if (this.renderer) this.renderer.dispose();
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    if (this.minimap && this.minimap.parentNode) this.minimap.parentNode.removeChild(this.minimap);
  };

  root.FPSWorld = FPSWorld;
})(typeof window !== 'undefined' ? window : this);

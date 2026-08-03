/* ============================================================================
 * Real-browser QA for Future Hide & Seek (Playwright + Chromium)
 * Runs: node test/qa-browser.js   (or npm run qa)
 * Loads the LIVE site, plays full games on desktop and mobile viewports.
 * The Seeker phase runs in FIRST-PERSON 3D (FPS) — movement via real WASD
 * keys, scanning via the real Scan button, aiming via the world's test hooks.
 * Captures console/page/network errors and screenshots.
 * ========================================================================== */
'use strict';

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const URL = process.env.QA_URL || 'https://future-hide-and-seek.onrender.com/';
const OUT = path.join(__dirname, '..', 'qa');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.log('FAIL:', msg); }
  else console.log('ok  :', msg);
}

function watch(page) {
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('requestfailed', r => errors.push('REQUESTFAILED: ' + r.url() + ' :: ' + ((r.failure() || {}).errorText || '?')));
  return errors;
}

async function playHiding(page, nHiders) {
  const used = new Set();
  for (let i = 0; i < nHiders; i++) {
    const locs = page.locator('#map-hide .spot:not(.inactive)');
    const count = await locs.count();
    let picked = -1;
    for (let j = 0; j < count; j++) {
      if (!used.has(await locs.nth(j).getAttribute('data-spot'))) { picked = j; break; }
    }
    check(picked >= 0, `hider ${i + 1}: fresh spot available`);
    await locs.nth(picked).click();
    used.add(await locs.nth(picked).getAttribute('data-spot'));
    await page.click('[data-action="confirm-hide"]');
    await page.click('#btn-privacy-ready');
  }
}

/* FPS: aim at a spot (test hook), then scan with the REAL scan button. */
async function fpsAimScan(page, spotId) {
  await page.evaluate((id) => window.FHSUI.fpsWorld().aimAtSpot(id), spotId);
  await page.waitForTimeout(120);
  await page.click('#scan-btn');
  if (await page.locator('[data-action="do-search"]').count()) await page.click('[data-action="do-search"]');
  const t = await page.locator('#modal-card').innerText().catch(() => '');
  if (t.includes('Found You!') || t.includes('escaped this round')) {
    await page.click('[data-action="continue-after-result"]');
  } else if (await page.locator('[data-action="close-modal"]').count()) {
    await page.click('[data-action="close-modal"]');
  }
}

/* Hiders pick spots in DOM order, so target #i hides at the i-th active spot
 * in DOM order (LOCATIONS order) — NOT the shuffled activeSpots array. */
async function domOrderActiveSpots(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#map-hide .spot'))
    .filter(s => !s.classList.contains('inactive'))
    .map(s => s.getAttribute('data-spot')));
}

/* FPS-specific checks + one real-input movement test.
 * Returns the active spots in DOM order (where hiders actually hid). */
async function checkFPS(page, label) {
  const info = await page.evaluate(() => {
    const w = window.FHSUI.fpsWorld();
    const cv = document.querySelector('#fps-wrap canvas');
    const mm = document.querySelector('#fps-wrap .fps-minimap');
    return {
      hasFps: !!w,
      canvas: cv ? { w: cv.clientWidth, h: cv.clientHeight } : null,
      minimap: !!mm,
      reticle: !!document.querySelector('#fps-reticle'),
      scanBtn: !!document.querySelector('#scan-btn'),
      domSpots: Array.from(document.querySelectorAll('#map-hide .spot'))
        .filter(s => !s.classList.contains('inactive'))
        .map(s => s.getAttribute('data-spot'))
    };
  });
  check(info.hasFps, label + ': FPS world created (WebGL active)');
  check(!!info.canvas && info.canvas.w > 300, label + ': 3D canvas rendered (' + (info.canvas ? Math.round(info.canvas.w) + 'x' + Math.round(info.canvas.h) : 'none') + ')');
  check(info.minimap, label + ': minimap present');
  check(info.reticle && info.scanBtn, label + ': reticle + scan button in HUD');

  // real keyboard movement
  const p1 = await page.evaluate(() => window.FHSUI.fpsWorld().getPos());
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(450);
  await page.keyboard.up('KeyW');
  const p2 = await page.evaluate(() => window.FHSUI.fpsWorld().getPos());
  const moved = Math.abs(p1.x - p2.x) + Math.abs(p1.z - p2.z);
  check(moved > 0.2, label + ': WASD movement moves the player (' + moved.toFixed(2) + ' units)');
  return info.domSpots;
}

async function playSeekerRounds(page, nRounds, nHiders, label) {
  for (let r = 1; r <= nRounds; r++) {
    await page.click('#btn-next-round');
    check(await page.locator('#screen-hide.active').count() === 1, label + ` round ${r}: hide screen`);
    await playHiding(page, nHiders);
    check(await page.locator('#screen-seek.active').count() === 1, label + ` round ${r}: seeker screen (FPS)`);
    const spots = await checkFPS(page, label + ` round ${r}`);
    for (let t = 0; t < nHiders; t++) {
      if (await page.locator('#screen-seek.active').count() === 0) break;
      await fpsAimScan(page, spots[t]);
    }
    check(await page.locator('#screen-round-results.active').count() === 1, label + ` round ${r}: results`);
    await page.screenshot({ path: path.join(OUT, label + '-r' + r + '-results.png') });
  }
  await page.click('#btn-next-round');
  check(await page.locator('#screen-champion.active').count() === 1, label + ': champion screen');
  const champName = await page.locator('#champ-name').innerText();
  check(champName.trim().length > 0, label + ': champion name shown: ' + champName.trim());
  await page.screenshot({ path: path.join(OUT, label + '-champion.png') });
}

(async () => {
  const browser = await chromium.launch();

  /* ---------------- DESKTOP ---------------- */
  console.log('=== DESKTOP (1280x800) ===');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => { window.__FPS_TEST__ = true; });
  const errs = watch(page);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  check(await page.locator('#screen-menu.active').count() === 1, 'menu screen active');
  await page.screenshot({ path: path.join(OUT, '01-menu.png') });

  await page.click('#btn-menu-start');
  await page.click('#count-row [data-count="3"]');
  const inputs = page.locator('#player-cards input');
  await inputs.nth(0).fill('Ali');
  await inputs.nth(1).fill('Bella');
  await inputs.nth(2).fill('Cody');
  await page.click('#btn-setup-start');
  if (await page.locator('#screen-tutorial.active').count()) await page.click('#btn-tut-skip');
  check(await page.locator('#screen-hide.active').count() === 1, 'hide screen active');
  await page.screenshot({ path: path.join(OUT, '02-hide.png') });

  await playHiding(page, 2);
  check(await page.locator('#screen-seek.active').count() === 1, 'seeker screen reached');
  const spots = await checkFPS(page, 'desktop');
  await page.screenshot({ path: path.join(OUT, '03-fps-seek.png') });

  // two targets
  await fpsAimScan(page, spots[0]);
  if (await page.locator('#screen-seek.active').count()) await fpsAimScan(page, spots[1]);
  check(await page.locator('#screen-round-results.active').count() === 1, 'round 1 results');
  await page.screenshot({ path: path.join(OUT, '04-results.png') });

  await playSeekerRounds(page, 2, 2, 'desktop'); // rounds 2-3

  if (errs.length) { failures += errs.length; errs.forEach(e => console.log('  !! ' + e)); }
  else console.log('ok  : zero console/page/network errors (desktop)');
  await page.close();

  /* ---------------- MOBILE ---------------- */
  console.log('=== MOBILE (390x844, touch) ===');
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mob.addInitScript(() => { window.__FPS_TEST__ = true; });
  const merr = watch(mob);
  await mob.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 1, 'no horizontal overflow (delta=' + overflow + ')');

  await mob.click('#btn-menu-start');
  await mob.click('#count-row [data-count="2"]');
  const mi = mob.locator('#player-cards input');
  await mi.nth(0).fill('Zoe');
  await mi.nth(1).fill('Max');
  await mob.click('#btn-setup-start');
  if (await mob.locator('#screen-tutorial.active').count()) await mob.click('#btn-tut-skip');
  await playHiding(mob, 1);
  check(await mob.locator('#screen-seek.active').count() === 1, 'mobile seeker screen reached');
  const mspots = await checkFPS(mob, 'mobile');
  await mob.screenshot({ path: path.join(OUT, 'm1-fps-seek.png') });
  await fpsAimScan(mob, mspots[0]);
  check(await mob.locator('#screen-round-results.active').count() === 1, 'mobile round 1 results');
  await playSeekerRounds(mob, 1, 1, 'mobile'); // round 2

  if (merr.length) { failures += merr.length; merr.forEach(e => console.log('  !! ' + e)); }
  else console.log('ok  : zero console/page/network errors (mobile)');
  await mob.close();

  await browser.close();
  console.log(failures ? `\nQA FAILED — ${failures} issue(s)` : '\nQA PASSED — FPS game plays cleanly on desktop + mobile');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('QA crashed:', e); process.exit(1); });

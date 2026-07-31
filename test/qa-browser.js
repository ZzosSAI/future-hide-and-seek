/* ============================================================================
 * Real-browser QA for Future Hide & Seek (Playwright + Chromium)
 * Runs: node test/qa-browser.js   (or npm run qa)
 * Loads the LIVE site, plays full games on desktop and mobile viewports,
 * captures console/page/network errors, checks layout sanity, screenshots.
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
    check(picked >= 0, `hider ${i + 1}: a fresh spot available (used=${used.size})`);
    await locs.nth(picked).click();
    used.add(await locs.nth(picked).getAttribute('data-spot'));
    check(await page.locator('[data-action="confirm-hide"]').count() === 1, `hider ${i + 1}: confirm modal`);
    await page.click('[data-action="confirm-hide"]');
    check(await page.locator('#btn-privacy-ready').count() === 1, `hider ${i + 1}: privacy pass`);
    await page.click('#btn-privacy-ready');
  }
}

async function playSeek(page, maxTries) {
  const searched = new Set();
  for (let i = 0; i < (maxTries || 40); i++) {
    if (await page.locator('#screen-seek.active').count() === 0) break;
    const locs = page.locator('#map-seek .spot:not(.inactive)');
    const count = await locs.count();
    let picked = -1;
    for (let j = 0; j < count; j++) {
      if (!searched.has(await locs.nth(j).getAttribute('data-spot'))) { picked = j; break; }
    }
    if (picked < 0) { picked = 0; }
    await locs.nth(picked).click();
    searched.add(await locs.nth(picked).getAttribute('data-spot'));
    let text = await page.locator('#modal-card').innerText().catch(() => '');
    if (text.includes('Just a hologram') || text.includes('Not a hiding place')) {
      await page.click('[data-action="close-modal"]');
      continue;
    }
    if (await page.locator('[data-action="do-search"]').count()) await page.click('[data-action="do-search"]');
    text = await page.locator('#modal-card').innerText().catch(() => '');
    if (text.includes('Found You!') || text.includes('escaped this round')) {
      await page.click('[data-action="continue-after-result"]');
    } else if (await page.locator('[data-action="close-modal"]').count()) {
      await page.click('[data-action="close-modal"]');
    }
  }
}

async function checkMap(page, selector, label) {
  const box = await page.locator(selector + ' svg').boundingBox();
  check(!!box && box.width > 300 && box.height > 150, label + ' map rendered with size ' + (box ? Math.round(box.width) + 'x' + Math.round(box.height) : 'NONE'));
  check(await page.locator(selector + ' .spot').count() === 22, label + ' 22 spots in DOM');
}

(async () => {
  const browser = await chromium.launch();

  /* ---------------- DESKTOP ---------------- */
  console.log('=== DESKTOP (1280x800) ===');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = watch(page);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  check(await page.locator('#screen-menu.active').count() === 1, 'menu screen active');
  await page.screenshot({ path: path.join(OUT, '01-menu.png') });

  await page.click('#btn-menu-start');
  check(await page.locator('#screen-setup.active').count() === 1, 'setup screen active');
  await page.screenshot({ path: path.join(OUT, '02-setup.png') });

  await page.click('#count-row [data-count="3"]');
  const inputs = page.locator('#player-cards input');
  check(await inputs.count() === 3, '3 player cards after count change');
  await inputs.nth(0).fill('Ali');
  await inputs.nth(1).fill('Bella');
  await inputs.nth(2).fill('Cody');
  await page.click('#btn-setup-start');
  if (await page.locator('#screen-tutorial.active').count()) {
    check(true, 'tutorial shown on first game');
    await page.click('#btn-tut-skip');
  }
  check(await page.locator('#screen-hide.active').count() === 1, 'hide screen active');
  await checkMap(page, '#map-hide', 'hide');
  await page.screenshot({ path: path.join(OUT, '03-hide.png') });

  await playHiding(page, 2);
  check(await page.locator('#screen-seek.active').count() === 1, 'seeker screen active');
  await checkMap(page, '#map-seek', 'seek');
  check(await page.locator('#topbar-seek .tb-chip.guesses').count() === 1, 'top bar shows guesses');
  await page.screenshot({ path: path.join(OUT, '04-seek.png') });

  await playSeek(page, 40);
  if (await page.locator('#screen-seek.active').count()) await playSeek(page, 40);
  check(await page.locator('#screen-round-results.active').count() === 1, 'round 1 results shown');
  await page.screenshot({ path: path.join(OUT, '05-results.png') });

  for (let r = 2; r <= 3; r++) {
    await page.click('#btn-next-round');
    check(await page.locator('#screen-hide.active').count() === 1, `round ${r}: hide screen`);
    await playHiding(page, 2);
    await playSeek(page, 40);
    if (await page.locator('#screen-seek.active').count()) await playSeek(page, 40);
    check(await page.locator('#screen-round-results.active').count() === 1, `round ${r}: results shown`);
  }
  await page.click('#btn-next-round');
  check(await page.locator('#screen-champion.active').count() === 1, 'champion screen reached');
  const champName = await page.locator('#champ-name').innerText();
  check(champName.trim().length > 0, 'champion name shown: ' + champName.trim());
  await page.screenshot({ path: path.join(OUT, '06-champion.png') });

  if (errs.length) { failures += errs.length; errs.forEach(e => console.log('  !! ' + e)); }
  else console.log('ok  : zero console/page/network errors (desktop)');
  await page.close();

  /* ---------------- MOBILE ---------------- */
  console.log('=== MOBILE (390x844, touch) ===');
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const merr = watch(mob);
  await mob.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 1, 'no horizontal overflow (delta=' + overflow + ')');
  await mob.screenshot({ path: path.join(OUT, 'm1-menu.png') });

  await mob.click('#btn-menu-start');
  await mob.click('#count-row [data-count="2"]');
  const mi = mob.locator('#player-cards input');
  await mi.nth(0).fill('Zoe');
  await mi.nth(1).fill('Max');
  await mob.click('#btn-setup-start');
  if (await mob.locator('#screen-tutorial.active').count()) await mob.click('#btn-tut-skip');
  check(await mob.locator('#screen-hide.active').count() === 1, 'mobile hide screen');
  await checkMap(mob, '#map-hide', 'mobile-hide');
  await mob.screenshot({ path: path.join(OUT, 'm2-hide.png') });

  await playHiding(mob, 1);
  check(await mob.locator('#screen-seek.active').count() === 1, 'mobile seek screen');
  await mob.screenshot({ path: path.join(OUT, 'm3-seek.png') });
  await playSeek(mob, 30);
  if (await mob.locator('#screen-seek.active').count()) await playSeek(mob, 30);
  check(await mob.locator('#screen-round-results.active').count() === 1, 'mobile round results');
  await mob.screenshot({ path: path.join(OUT, 'm4-results.png') });

  await mob.click('#btn-next-round');
  check(await mob.locator('#screen-hide.active').count() === 1, 'mobile round 2 hide');
  await playHiding(mob, 1);
  await playSeek(mob, 30);
  if (await mob.locator('#screen-seek.active').count()) await playSeek(mob, 30);
  check(await mob.locator('#screen-round-results.active').count() === 1, 'mobile round 2 results');
  await mob.click('#btn-next-round');
  check(await mob.locator('#screen-champion.active').count() === 1, 'mobile champion screen');
  await mob.screenshot({ path: path.join(OUT, 'm5-champion.png') });

  if (merr.length) { failures += merr.length; merr.forEach(e => console.log('  !! ' + e)); }
  else console.log('ok  : zero console/page/network errors (mobile)');
  await mob.close();

  await browser.close();
  console.log(failures ? `\nQA FAILED — ${failures} issue(s)` : '\nQA PASSED — game plays cleanly on desktop + mobile');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('QA crashed:', e); process.exit(1); });

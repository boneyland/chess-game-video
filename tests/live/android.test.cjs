// Smoke tests in Chrome on Android, a real phone or an emulator, driven by Playwright's Android support over adb,
// against a build of this checkout served by serve.cjs and reached from the device through `adb reverse`:
//   node --test tests/live/android.test.cjs
// Needs adb on the PATH with one device, Chrome on it and, unless the device is debuggable (an emulator's google_apis
// image is), chrome://flags › "Enable command line on non-rooted devices" turned on. GitHub Actions runs it on an
// emulator (the `android` job). Taps are touch events sent through Chrome's DevTools protocol, so they go through the
// page's real touch handling, not mouse events. Screenshots go to tests/out/live/.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const pw = (() => { try { return require('playwright'); } catch (e) { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } })();
const { serve } = require('./serve.cjs');
const { loadedOn, boardBox, square } = require('./board.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tests', 'out', 'live');
const PORT = 8767; // the same port on the device, through adb reverse
const VERDICT = /your move · .*(stockfish’s choice|cp vs|as good as|can’t run here|stopped)/i;

test('android · chrome · local build', async (t) => {
  fs.mkdirSync(OUT, { recursive: true });
  execFileSync(process.execPath, [path.join(ROOT, 'build.cjs')], { cwd: ROOT });
  const local = await serve(path.join(ROOT, 'out', 'site'), PORT);
  t.after(() => local.close());

  const [device] = await pw._android.devices();
  assert.ok(device, 'no adb device');
  t.after(() => device.close());
  const sh = async (cmd) => (await device.shell(cmd)).toString().trim();
  assert.match(await sh('pm list packages com.android.chrome'), /com\.android\.chrome/, 'Chrome is not installed on the device');
  t.diagnostic(`${device.model()} · Android ${await sh('getprop ro.build.version.release')} · ${(await sh('dumpsys package com.android.chrome | grep versionName')).split('\n')[0]}`);
  execFileSync('adb', ['-s', device.serial(), 'reverse', `tcp:${PORT}`, `tcp:${PORT}`]);
  t.after(() => execFileSync('adb', ['-s', device.serial(), 'reverse', '--remove', `tcp:${PORT}`]));

  const ctx = await device.launchBrowser({ hasTouch: true }); // Playwright's taps need it set, though the phone has touch anyway
  t.after(() => ctx.close());
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  // a phone kept from an earlier run starts from the defaults
  await page.goto(local.url, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());

  await t.test('the page loads in the phone layout, fits the width, with no console errors', async () => {
    await page.reload({ waitUntil: 'load' });
    await loadedOn(page);
    await page.getByRole('button', { name: 'Menu' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll');
    const b = await boardBox(page), w = await page.evaluate(() => window.innerWidth);
    assert.equal(b.n, 32, 'pieces on the board');
    assert.ok(b.x0 >= 0 && b.x0 + 8 * b.sq <= w + 1, `the board (${Math.round(8 * b.sq)} px) fits the ${w} px width`);
    await page.screenshot({ path: path.join(OUT, 'android-phone.png') });
    assert.deepEqual(errors, []);
  });

  await t.test('a tap-tap move gets a Stockfish verdict', async () => {
    const b = await boardBox(page);
    for (const sq of ['e2', 'e4']) { const p = square(b, sq); await page.touchscreen.tap(p.x, p.y); }
    await page.getByText(/your move ·/i).waitFor({ timeout: 5000 });
    // the emulator runs the engine slowly
    await page.waitForFunction((re) => new RegExp(re, 'i').test(document.body.innerText), VERDICT.source, { timeout: 120000 });
    assert.doesNotMatch(await page.getByText(/your move ·/i).innerText(), /can’t run here|stopped/i);
    await page.screenshot({ path: path.join(OUT, 'android-own-move.png') });
    assert.deepEqual(errors, []);
  });

  await t.test('the menu opens, and its Full screen goes full screen and back', async () => {
    const menu = page.getByRole('button', { name: 'Menu' });
    await menu.tap();
    await page.getByRole('button', { name: 'Ask Queen' }).waitFor({ state: 'visible', timeout: 3000 });
    await page.getByRole('button', { name: 'Full screen', exact: true }).tap();
    await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 5000 });
    // upright in full screen, a fixed gap clears the camera's punch hole
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).paddingTop), '24px');
    await page.screenshot({ path: path.join(OUT, 'android-full-screen.png') });
    await menu.tap();
    await page.getByRole('button', { name: 'Exit full screen' }).tap();
    await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 5000 });
  });

  await t.test('the service worker takes over the page', async () => {
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 30000 });
    assert.deepEqual(errors, []);
  });
});

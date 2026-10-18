// Smoke tests for the deployed sites. Not part of tests/*.test.cjs, so deploy builds never hit the network:
//   node --test tests/live/site.test.cjs
// LIVE_URLS: comma-separated sites to test (default: both production sites; a Netlify deploy preview works too).
// LIVE_CDN_DIR: for sandboxes that block cdnjs, a folder holding the react and react-dom 18.3.1 npm packages
// (<dir>/react/package/umd/…); the page's React requests are answered from it.
// Needs Playwright (global install is fine). Screenshots go to tests/out/live/.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, execSync } = require('child_process');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } })();

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tests', 'out', 'live');
const SITES = (process.env.LIVE_URLS || 'https://chess-replay.netlify.app/,https://chess-replay.onrender.com/').split(',').map((u) => u.trim().replace(/\/?$/, '/'));
const PAGE = 'chess-game-video.html';
const SF = 'stockfish-19-lite-single';

let browser, built;
test.before(async () => {
  browser = await chromium.launch();
  fs.mkdirSync(OUT, { recursive: true });
  execFileSync(process.execPath, [path.join(ROOT, 'build.cjs')], { cwd: ROOT });
  built = fs.readFileSync(path.join(ROOT, 'out', 'site', PAGE), 'utf8');
});
test.after(() => browser && browser.close());

async function open(viewport) {
  const ctx = await browser.newContext({ viewport });
  const cdn = process.env.LIVE_CDN_DIR;
  if (cdn) await ctx.route('https://cdnjs.cloudflare.com/ajax/libs/**', (r) => {
    const m = r.request().url().match(/\/(react|react-dom)\/18\.3\.1\/umd\/([\w.-]+)$/);
    return m ? r.fulfill({ path: path.join(cdn, m[1], 'package', 'umd', m[2]), contentType: 'text/javascript' }) : r.continue();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}

// The board is where the 32 pieces stand at the start: the union of the piece images' boxes
async function boardBox(page) {
  return page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')].map((i) => i.getBoundingClientRect()).filter((r) => r.width > 10);
    const w = imgs.map((r) => Math.round(r.width)).sort((a, b) => a - b)[Math.floor(imgs.length / 2)];
    const pcs = imgs.filter((r) => Math.abs(r.width - w) < 2);
    const x0 = Math.min(...pcs.map((r) => r.left)), y0 = Math.min(...pcs.map((r) => r.top));
    const x1 = Math.max(...pcs.map((r) => r.right)), y1 = Math.max(...pcs.map((r) => r.bottom));
    return { n: pcs.length, x0, y0, sq: (x1 - x0) / 8, h: y1 - y0 };
  });
}
const square = (b, name) => ({ x: b.x0 + (name.charCodeAt(0) - 97 + 0.5) * b.sq, y: b.y0 + (8 - +name[1] + 0.5) * b.sq });

for (const base of SITES) {
  const host = new URL(base).host;
  test(host, async (t) => {
    const { ctx, page, errors } = await open({ width: 1440, height: 900 });
    // requests go through the page (same origin), so they take the browser's network path and proxy
    const get = (p) => page.evaluate(async (u) => {
      const r = await fetch(u, { cache: 'no-store' });
      const buf = new Uint8Array(await r.arrayBuffer());
      return { status: r.status, type: r.headers.get('content-type') || '', cache: r.headers.get('cache-control') || '', text: new TextDecoder().decode(buf), sha: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map((x) => x.toString(16).padStart(2, '0')).join('') };
    }, base + p);
    // the page has rendered and the board has its pieces
    const loaded = async () => { await page.locator('.dock-primary').waitFor({ state: 'attached' }); await page.waitForFunction(() => document.querySelectorAll('img').length >= 32); };

    await t.test('desktop: the sample game loads with no console errors', async () => {
      await page.goto(base, { waitUntil: 'load' });
      await loaded();
      const b = await boardBox(page);
      assert.equal(b.n, 32, 'pieces on the board');
      assert.ok(Math.abs(b.h - 8 * b.sq) < 4, 'the board is square');
      await page.screenshot({ path: path.join(OUT, host + '-desktop.png') });
      assert.deepEqual(errors, []);
    });

    await t.test('the bare domain and the page file both serve the page, revalidated on every visit', async () => {
      for (const p of ['', PAGE]) {
        const r = await get(p);
        assert.equal(r.status, 200, p || '/');
        assert.match(r.type, /text\/html/);
        assert.match(r.cache, /max-age=0.*must-revalidate/, (p || '/') + ' Cache-Control');
        assert.match(r.text, /window\.TWEAK_DEFAULTS/);
      }
    });

    await t.test('the Stockfish files are served next to the page', async () => {
      const js = await get(SF + '.js'), wasm = await get(SF + '.wasm');
      assert.equal(js.status, 200);
      assert.equal(wasm.status, 200);
      assert.match(wasm.type, /application\/wasm/);
      assert.equal(wasm.sha, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'vendor', SF + '.wasm'))).digest('hex'));
    });

    await t.test('the live page against a local build of this checkout', async () => {
      // Netlify adds an advert comment to the head of every HTML page it serves
      const live = (await get(PAGE)).text.replace(/<!-- This site is hosted on Netlify\.[\s\S]*?-->\n?/, '');
      t.diagnostic(host + (live === built ? ': same as this checkout' : ': differs from this checkout (deploy not published yet, or the checkout is ahead)'));
    });

    await t.test('desktop: Next and Previous step through the moves', async () => {
      const label = page.locator('.plabel');
      await page.getByRole('button', { name: 'Back to start (Home)' }).click();
      await page.getByRole('button', { name: 'Next move (→)' }).click();
      await assert.doesNotReject(label.filter({ hasText: /^1\.\s*\S/ }).waitFor({ timeout: 5000 }));
      await page.getByRole('button', { name: 'Previous move (←)' }).click();
      await assert.doesNotReject(label.filter({ hasText: 'Start' }).waitFor({ timeout: 5000 }));
    });

    await t.test('desktop: an own move gets a Stockfish verdict', async () => {
      const b = await boardBox(page);
      const from = square(b, 'e2'), to = square(b, 'e4');
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
      // the panel's text is upper-cased by CSS, so innerText reads it that way
      const panel = page.getByText(/your move ·/i);
      await panel.waitFor({ timeout: 5000 });
      await page.waitForFunction(() => /your move · .*(stockfish’s choice|cp vs|as good as|can’t run here|stopped)/i.test(document.body.innerText), null, { timeout: 45000 });
      const text = await panel.innerText();
      assert.doesNotMatch(text, /can’t run here|stopped/i, text);
      await page.screenshot({ path: path.join(OUT, host + '-own-move.png') });
      assert.deepEqual(errors, []);
    });

    await t.test('desktop: a changed setting survives a reload', async () => {
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' }).click();
      await page.reload({ waitUntil: 'load' });
      await loaded();
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-scheme')), 'dark');
    });

    await t.test('desktop: Space presses a focused button rather than playing, and Esc closes the panel', async () => {
      await page.getByRole('button', { name: 'Settings' }).focus();
      await page.keyboard.press('Space');
      const settings = page.getByRole('complementary', { name: 'Settings' });
      await assert.doesNotReject(settings.waitFor({ timeout: 3000 }));
      assert.equal(await page.getByRole('button', { name: 'Pause (space)' }).count(), 0, 'Space started playback');
      await page.keyboard.press('Escape');
      await assert.doesNotReject(settings.waitFor({ state: 'detached', timeout: 3000 }));
    });

    await t.test('desktop: Esc closes the Queen panel', async () => {
      await page.getByRole('button', { name: 'Ask Queen' }).click();
      const queen = page.locator('.q-panel');
      await queen.waitFor({ timeout: 3000 });
      await page.keyboard.press('Escape');
      await assert.doesNotReject(queen.waitFor({ state: 'detached', timeout: 3000 }));
    });

    await t.test('desktop: the playhead takes the arrow keys, and the Moves panel is one Tab stop', async () => {
      const head = page.getByRole('slider', { name: 'Playhead' });
      await head.focus();
      await page.keyboard.press('End');
      assert.equal(await head.getAttribute('aria-valuenow'), await head.getAttribute('aria-valuemax'));
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      assert.equal(await head.getAttribute('aria-valuenow'), '1');
      assert.match(await head.getAttribute('aria-valuetext'), /^1 second of \d+ minutes? /);
      assert.equal(await page.locator('[data-ply][tabindex="0"]').count(), 1, 'Tab stops in the Moves panel');
      await page.locator('[data-ply="0"]').focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.ply === '1', null, { timeout: 3000 });
      await assert.doesNotReject(page.locator('.plabel').filter({ hasText: /^1…/ }).waitFor({ timeout: 3000 }));
    });

    // Playwright can't drag a file in with the mouse, so this one dispatches the drag event
    await t.test('desktop: a file dragged over the page gets the drop overlay over the whole page', async () => {
      const files = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(['1. e4 *'], 'game.pgn')); return d; });
      await page.dispatchEvent('body', 'dragover', { dataTransfer: files });
      const box = await page.locator('.drop').boundingBox();
      assert.deepEqual(box, { x: 0, y: 0, width: 1440, height: 900 });
      assert.equal(await page.locator('.drop').evaluate((e) => getComputedStyle(e).position), 'fixed');
    });
    await t.test('desktop: the dock toggles full screen, and hides the item where the browser can’t', async () => {
      await page.getByRole('button', { name: 'Full screen', exact: true }).click();
      await page.waitForFunction(() => document.documentElement === document.fullscreenElement, null, { timeout: 3000 });
      await page.getByRole('button', { name: 'Exit full screen' }).click();
      await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 3000 });
      // as on iPhone Safari, or in a frame without allow="fullscreen"
      const off = await open({ width: 1440, height: 900 });
      await off.ctx.addInitScript(() => { for (const k of ['fullscreenEnabled', 'webkitFullscreenEnabled']) Object.defineProperty(Document.prototype, k, { get: () => false }); });
      await off.page.goto(base, { waitUntil: 'load' });
      await off.page.locator('.dock-primary').waitFor();
      assert.equal(await off.page.getByRole('button', { name: /full screen/i }).count(), 0);
      await off.ctx.close();
    });

    await t.test('the web app manifest and its icons are served', async () => {
      const m = await get('manifest.webmanifest');
      assert.equal(m.status, 200);
      for (const ic of JSON.parse(m.text).icons.concat({ src: 'apple-touch-icon.png' })) {
        const r = await get(ic.src);
        assert.equal(r.status, 200, ic.src);
        assert.match(r.type, /image\/png/, ic.src);
      }
    });
    await ctx.close();

    await t.test('phone: the layout fits the width and folds the buttons into a menu', async () => {
      const ph = await open({ width: 390, height: 844 });
      await ph.page.goto(base, { waitUntil: 'load' });
      const menu = ph.page.getByRole('button', { name: 'Menu' });
      await menu.waitFor();
      assert.equal(await ph.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll');
      assert.equal((await boardBox(ph.page)).n, 32);
      await ph.page.screenshot({ path: path.join(OUT, host + '-phone.png') });
      await menu.click();
      await assert.doesNotReject(ph.page.getByRole('button', { name: 'Ask Queen' }).waitFor({ state: 'visible', timeout: 3000 }));
      // Chromium supports element full screen, so the menu offers it; the label follows fullscreenchange
      const fsOn = () => ph.page.evaluate(() => !!document.fullscreenElement);
      await ph.page.getByRole('button', { name: 'Full screen', exact: true }).click();
      await ph.page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 3000 });
      await menu.click();
      await ph.page.getByRole('button', { name: 'Exit full screen' }).click();
      await ph.page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 3000 });
      assert.equal(await fsOn(), false);
      await menu.click();
      await assert.doesNotReject(ph.page.getByRole('button', { name: 'Full screen', exact: true }).waitFor({ state: 'visible', timeout: 3000 }));
      assert.deepEqual(ph.errors, []);
      await ph.ctx.close();
    });

    // a phone held sideways used to get the 16:9 video shrunk to a board about 230 px high
    await t.test('phone held sideways: the board fills the height and the buttons fold into a menu', async () => {
      const ph = await open({ width: 844, height: 390 });
      await ph.page.goto(base, { waitUntil: 'load' });
      await ph.page.getByRole('button', { name: 'Menu' }).waitFor();
      assert.equal(await ph.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll');
      const b = await boardBox(ph.page);
      assert.equal(b.n, 32);
      assert.ok(b.h > 260, `board ${Math.round(b.h)} px high`);
      await ph.page.screenshot({ path: path.join(OUT, host + '-phone-sideways.png') });
      assert.deepEqual(ph.errors, []);
      await ph.ctx.close();
    });
  });
}

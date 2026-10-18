// Smoke tests for the deployed site, in Chromium and Firefox. Not part of tests/*.test.cjs, so deploy builds never
// hit the network:
//   node --test tests/live/site.test.cjs
// LIVE_URLS: comma-separated sites to test (default: the Render site); `local` builds this checkout and serves
// out/site the way render.yaml has Render serve it (serve.cjs), which is what GitHub Actions tests.
// LIVE_BROWSERS: chromium, firefox or both (the default), run one after the other.
// CHROMIUM_PATH / CHROMIUM_CHANNEL pick the Chromium (default: the ungoogled-chromium flatpak where it is installed,
// else Playwright's own); FIREFOX_PATH the Firefox (default: Firefox Developer Edition, else /usr/bin/firefox),
// driven over WebDriver BiDi, so any stock Firefox works without a Playwright build of it.
// LIVE_CDN_DIR: for sandboxes that block cdnjs, a folder holding the react and react-dom 18.3.1 npm packages
// (<dir>/react/package/umd/…); the page's React requests are answered from it.
// Needs Playwright (global install is fine). Screenshots go to tests/out/live/.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, execSync } = require('child_process');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const pw = (() => { try { return require('playwright'); } catch (e) { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } })();
const { serve } = require('./serve.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tests', 'out', 'live');
const SITES = (process.env.LIVE_URLS || 'https://chess-replay.onrender.com/').split(',').map((u) => u.trim()).map((u) => (u === 'local' ? u : u.replace(/\/?$/, '/')));
const BROWSERS = (process.env.LIVE_BROWSERS || 'chromium,firefox').split(',').map((b) => b.trim());
const PAGE = 'chess-game-video.html';
const SF = 'stockfish-19-lite-single';
const firstFile = (...files) => files.find((f) => f && fs.existsSync(f));
const LAUNCH = {
  chromium: () => pw.chromium.launch({ channel: process.env.CHROMIUM_CHANNEL, executablePath: process.env.CHROMIUM_PATH || firstFile('/var/lib/flatpak/exports/bin/io.github.ungoogled_software.ungoogled_chromium') }),
  firefox: () => pw.firefox.launch({ channel: 'moz-firefox', executablePath: process.env.FIREFOX_PATH || firstFile('/usr/bin/firefox-devedition', '/usr/bin/firefox') }),
};

let built, local = null;
test.before(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  execFileSync(process.execPath, [path.join(ROOT, 'build.cjs')], { cwd: ROOT });
  built = fs.readFileSync(path.join(ROOT, 'out', 'site', PAGE), 'utf8');
  if (SITES.includes('local')) local = await serve(path.join(ROOT, 'out', 'site'));
});
test.after(() => local && local.close());

async function open(browser, viewport, opts) {
  const ctx = await browser.newContext({ viewport, ...opts });
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
const square = (b, name, flipped) => (flipped
  ? { x: b.x0 + (7 - (name.charCodeAt(0) - 97) + 0.5) * b.sq, y: b.y0 + (+name[1] - 1 + 0.5) * b.sq }
  : { x: b.x0 + (name.charCodeAt(0) - 97 + 0.5) * b.sq, y: b.y0 + (8 - +name[1] + 0.5) * b.sq });

for (const name of BROWSERS) for (const site of SITES) {
  test(`${name} · ${site === 'local' ? 'local build' : new URL(site).host}`, async (t) => {
    const base = site === 'local' ? local.url : site, host = name + '-' + (site === 'local' ? 'local' : new URL(site).host);
    // one browser at a time, closed before the next starts
    const browser = await LAUNCH[name]();
    t.after(() => browser.close());
    const { ctx, page, errors } = await open(browser, { width: 1440, height: 900 });
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
      const live = (await get(PAGE)).text;
      t.diagnostic(base + (live === built ? ': same as this checkout' : ': differs from this checkout (deploy not published yet, or the checkout is ahead)'));
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
      const off = await open(browser, { width: 1440, height: 900 });
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
    // a pawn reaching the last rank asks for its piece: Esc takes the move back, a click on the column picks one
    await t.test('desktop: an own promotion offers the four pieces', async () => {
      const pr = await open(browser, { width: 1440, height: 900 });
      await pr.page.goto(base, { waitUntil: 'load' });
      await pr.page.locator('.dock-primary').waitFor();
      await pr.page.setInputFiles('#game-files', { name: 'promo.pgn', mimeType: 'text/plain', buffer: Buffer.from('1. e4 d5 2. exd5 c6 3. dxc6 Qd6 4. cxb7 Qd5 *') });
      await pr.page.waitForFunction(() => /Qd5/.test(document.body.innerText), null, { timeout: 10000 });
      await pr.page.keyboard.press('End');
      await assert.doesNotReject(pr.page.locator('.plabel').filter({ hasText: /Qd5/ }).waitFor({ timeout: 5000 }));
      const b = await boardBox(pr.page), drag = async () => {
        const from = square(b, 'b7'), to = square(b, 'a8');
        await pr.page.mouse.move(from.x, from.y);
        await pr.page.mouse.down();
        await pr.page.mouse.move(to.x, to.y, { steps: 8 });
        await pr.page.mouse.up();
      };
      const picker = pr.page.getByRole('button', { name: /^Promote to / });
      await drag();
      assert.deepEqual(await picker.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))), ['Promote to queen', 'Promote to knight', 'Promote to rook', 'Promote to bishop']);
      await pr.page.screenshot({ path: path.join(OUT, host + '-promotion.png') });
      await pr.page.keyboard.press('Escape');
      assert.equal(await picker.count(), 0, 'Esc closes the picker');
      assert.match(await pr.page.locator('.plabel').innerText(), /Qd5/, 'and plays nothing');
      await drag();
      const knight = square(b, 'a7'); // the column runs down from a8: queen, knight, rook, bishop
      await pr.page.mouse.click(knight.x, knight.y);
      await assert.doesNotReject(pr.page.locator('.plabel').filter({ hasText: /bxa8=N/ }).waitFor({ timeout: 5000 }));
      assert.equal(await picker.count(), 0);
      assert.deepEqual(pr.errors, []);
      await pr.ctx.close();
    });
    // Flip board turns every square→pixel conversion: pieces, the eval bar, the player bars, and the pointer input
    await t.test('desktop: Flip board turns the board and keeps moves under the pointer', async () => {
      const fl = await open(browser, { width: 1440, height: 900 });
      const top = (sel) => fl.page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top, sel);
      // the white king's image above the black king's: the kings are the only pieces on e1/e8 at the start
      const kings = () => fl.page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => i.src === window.PIECE_IMG.wK || i.src === window.PIECE_IMG.bK).map((i) => ({ white: i.src === window.PIECE_IMG.wK, top: i.getBoundingClientRect().top })).filter((o, i, all) => all.findIndex((q) => q.white === o.white) === i));
      await fl.page.goto(base, { waitUntil: 'load' });
      await fl.page.locator('.dock-primary').waitFor();
      await fl.page.waitForFunction(() => document.querySelectorAll('img').length >= 32);
      const before = await kings();
      assert.equal(before.length, 2, 'two kings found: ' + JSON.stringify(before));
      await fl.page.getByRole('button', { name: 'Settings' }).click();
      const sw = fl.page.getByRole('switch', { name: 'Flip board' });
      await sw.click();
      assert.equal(await sw.getAttribute('aria-checked'), 'true');
      await fl.page.getByRole('button', { name: 'Close settings' }).click();
      const wk = (ks) => ks.find((k) => k.white).top, bk = (ks) => ks.find((k) => !k.white).top;
      const after = await kings();
      assert.ok(wk(before) > bk(before), 'white king at the bottom by default');
      assert.ok(wk(after) < bk(after), 'white king above the black king when flipped');
      // the sample game's players; the player bars' names are the 20 px ones (the header's are 40 px)
      const bars = await fl.page.evaluate(() => {
        const t = (re) => [...document.querySelectorAll('span')].filter((e) => re.test(e.textContent) && e.children.length === 0 && getComputedStyle(e).fontSize === '20px').map((e) => e.getBoundingClientRect().top);
        return { white: t(/^Carlsen/), black: t(/^Nepomniachtchi/) };
      });
      assert.ok(bars.white.length && bars.black.length, 'player bars found: ' + JSON.stringify(bars));
      const bt = await boardBox(fl.page);
      assert.ok(Math.min(...bars.white) < bt.y0, 'the White bar is above the board');
      assert.ok(Math.min(...bars.black) > bt.y0 + bt.h - 1, 'the Black bar is below the board');
      // the eval bar's white part is at its top
      const white = await fl.page.evaluate((b) => {
        const bar = [...document.querySelectorAll('div')].find((d) => { const r = d.getBoundingClientRect(); return Math.abs(r.width - 36 * b.sq / 100) < 1.5 && Math.abs(r.height - b.h) < 2 && getComputedStyle(d).overflow === 'hidden'; });
        if (!bar) return null;
        const w = [...bar.children].find((c) => getComputedStyle(c).backgroundColor === 'rgb(255, 255, 255)'), br = bar.getBoundingClientRect(), wr = w.getBoundingClientRect();
        return { top: wr.top - br.top, bottom: br.bottom - wr.bottom };
      }, bt);
      assert.ok(white && white.top < 2 && white.bottom > 2, 'eval bar fills White from the top: ' + JSON.stringify(white));
      const b = await boardBox(fl.page);
      const from = square(b, 'e2', true), to = square(b, 'e4', true);
      await fl.page.mouse.move(from.x, from.y);
      await fl.page.mouse.down();
      await fl.page.mouse.move(to.x, to.y, { steps: 8 });
      await fl.page.mouse.up();
      await assert.doesNotReject(fl.page.locator('.plabel').filter({ hasText: /You 1\. e4/ }).waitFor({ timeout: 5000 }));
      await fl.page.screenshot({ path: path.join(OUT, host + '-flipped.png') });
      // the flip is remembered
      await fl.page.reload({ waitUntil: 'load' });
      await fl.page.locator('.dock-primary').waitFor();
      await fl.page.waitForFunction(() => document.querySelectorAll('img').length >= 32);
      const again = await kings();
      assert.ok(wk(again) < bk(again), 'still flipped after a reload');
      // F flips back
      await fl.page.mouse.click(5, 5);
      await fl.page.keyboard.press('f');
      const back = await kings();
      assert.ok(wk(back) > bk(back), 'F unflips');
      await fl.page.keyboard.press('f');
      // the promotion picker runs from a8 towards the middle as seen: up the screen
      await fl.page.setInputFiles('#game-files', { name: 'promo.pgn', mimeType: 'text/plain', buffer: Buffer.from('1. e4 d5 2. exd5 c6 3. dxc6 Qd6 4. cxb7 Qd5 *') });
      await fl.page.waitForFunction(() => /Qd5/.test(document.body.innerText), null, { timeout: 10000 });
      await fl.page.keyboard.press('End');
      await assert.doesNotReject(fl.page.locator('.plabel').filter({ hasText: /Qd5/ }).waitFor({ timeout: 5000 }));
      const pb = await boardBox(fl.page), pf = square(pb, 'b7', true), pt = square(pb, 'a8', true);
      await fl.page.mouse.move(pf.x, pf.y);
      await fl.page.mouse.down();
      await fl.page.mouse.move(pt.x, pt.y, { steps: 8 });
      await fl.page.mouse.up();
      const tops = await fl.page.getByRole('button', { name: /^Promote to / }).evaluateAll((els) => els.map((e) => [e.getAttribute('aria-label'), e.getBoundingClientRect().top]));
      assert.deepEqual(tops.map((x) => x[0]), ['Promote to queen', 'Promote to knight', 'Promote to rook', 'Promote to bishop']);
      assert.ok(tops[0][1] > tops[1][1] && tops[1][1] > tops[2][1] && tops[2][1] > tops[3][1], 'queen lowest, bishop highest: ' + JSON.stringify(tops));
      await fl.page.keyboard.press('Escape');
      await fl.page.keyboard.press('f'); // leave nothing flipped behind
      assert.deepEqual(fl.errors, []);
      await fl.ctx.close();
    });
    await t.test('phone: a flipped board fits the width', async () => {
      const ph = await open(browser, { width: 390, height: 844 }, name === 'chromium' ? { isMobile: true, hasTouch: true } : { hasTouch: true });
      await ph.page.addInitScript(() => { try { localStorage.setItem('chess-video.tweaks.v1', JSON.stringify({ flip: true })); } catch (e) {} });
      await ph.page.goto(base, { waitUntil: 'load' });
      await ph.page.getByRole('button', { name: 'Menu' }).waitFor();
      assert.equal((await boardBox(ph.page)).n, 32);
      await ph.page.screenshot({ path: path.join(OUT, host + '-flipped-phone.png') });
      assert.deepEqual(ph.errors, []);
      await ph.ctx.close();
    });
    // a game from a FEN with Black to move: pieces from that position, numbering from move 3, own moves continue the count
    await t.test('desktop: a game from a FEN with Black to move replays and takes own moves', async () => {
      const fp = await open(browser, { width: 1440, height: 900 });
      await fp.page.goto(base, { waitUntil: 'load' });
      await fp.page.locator('.dock-primary').waitFor();
      const pgn = '[SetUp "1"]\n[FEN "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 3"]\n\n3... Nf6 4. Nc3 Bc5 *';
      await fp.page.setInputFiles('#game-files', { name: 'fen.pgn', mimeType: 'text/plain', buffer: Buffer.from(pgn) });
      await fp.page.waitForFunction(() => /Bc5/.test(document.body.innerText), null, { timeout: 10000 });
      await fp.page.keyboard.press('End');
      await assert.doesNotReject(fp.page.locator('.plabel').filter({ hasText: /4… Bc5/ }).waitFor({ timeout: 5000 }));
      const b = await boardBox(fp.page);
      assert.equal(b.n, 32);
      const moves = await fp.page.locator('[data-ply="0"]').evaluate((el) => el.parentElement.parentElement.parentElement.innerText);
      assert.match(moves, /3\.\s*…\s*Nf6\s*4\.\s*Nc3\s*Bc5/);
      const from = square(b, 'd2'), to = square(b, 'd3');
      await fp.page.mouse.move(from.x, from.y);
      await fp.page.mouse.down();
      await fp.page.mouse.move(to.x, to.y, { steps: 8 });
      await fp.page.mouse.up();
      await assert.doesNotReject(fp.page.locator('.plabel').filter({ hasText: /5\. d3/ }).waitFor({ timeout: 5000 }));
      await fp.page.screenshot({ path: path.join(OUT, host + '-fen-start.png') });
      assert.deepEqual(fp.errors, []);
      await fp.ctx.close();
    });
    await ctx.close();

    await t.test('phone: the layout fits the width and folds the buttons into a menu', async () => {
      // Firefox has no mobile emulation in Playwright: there it is a narrow window with touch
      const ph = await open(browser, { width: 390, height: 844 }, name === 'chromium' ? { isMobile: true, hasTouch: true } : { hasTouch: true });
      await ph.page.goto(base, { waitUntil: 'load' });
      const menu = ph.page.getByRole('button', { name: 'Menu' });
      await menu.waitFor();
      assert.equal(await ph.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll');
      assert.equal((await boardBox(ph.page)).n, 32);
      await ph.page.screenshot({ path: path.join(OUT, host + '-phone.png') });
      await menu.click();
      await assert.doesNotReject(ph.page.getByRole('button', { name: 'Ask Queen' }).waitFor({ state: 'visible', timeout: 3000 }));
      // both browsers support element full screen, so the menu offers it; the label follows fullscreenchange
      const fsOn = () => ph.page.evaluate(() => !!document.fullscreenElement);
      await ph.page.getByRole('button', { name: 'Full screen', exact: true }).click();
      await ph.page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 3000 });
      // upright in full screen, a fixed gap clears the camera's punch hole (a coarse pointer only: not Firefox's window)
      if (name === 'chromium') assert.equal(await ph.page.evaluate(() => getComputedStyle(document.documentElement).paddingTop), '24px');
      // headless Firefox's full screen is its 1366×768 screen, where the page lays out for a desktop: no menu
      if (await menu.isVisible()) await menu.click();
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
      const ph = await open(browser, { width: 844, height: 390 });
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

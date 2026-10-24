// Board helpers shared by the live tests (site.test.cjs, android.test.cjs)
// the page has rendered and the board has its pieces
const loadedOn = async (page) => { await page.locator('.dock-primary').waitFor({ state: 'attached' }); await page.waitForFunction(() => document.querySelectorAll('img').length >= 32); };

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

module.exports = { loadedOn, boardBox, square };

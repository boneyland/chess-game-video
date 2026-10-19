// The site's service worker (build.cjs fills in VERSION, LOCAL and REMOTE): it keeps a copy of the page and everything
// it loads, so the player, Stockfish and the export work with no connection. Only Ask Queen and Hugging Face sign-in
// need the network. The page itself comes from the network first, so a deploy shows up at once; the files around it
// change only with a deploy that changes this file's VERSION, so they come from the copy first.
const VERSION = '__VERSION__';
const LOCAL = __LOCAL__; // next to the page, the page first
const REMOTE = __REMOTE__; // pinned CDN files: React, the export's libraries, the fonts' stylesheet
const PAGE = 'chess-game-video.html';
const CACHE = 'chess-replay-' + VERSION;
// hosts whose files are kept as they're used (the fonts' stylesheet names font files by the browser that asks)
const KEEP_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
// a page that hasn't answered by then comes from the copy (a connection that is up but not getting through)
const PAGE_TIMEOUT_MS = 6000;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(LOCAL);
    // the CDN files are kept if they can be fetched now, and otherwise when the page first uses them
    await Promise.all(REMOTE.map(async (url) => {
      try {
        const r = await fetch(url, { mode: 'cors' });
        if (!r.ok) return;
        await cache.put(url, r.clone());
        if (/^https:\/\/fonts\.googleapis\.com\//.test(url)) {
          const css = await r.text();
          await Promise.all([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => cache.add(new Request(m[1], { mode: 'cors' })).catch(() => {})));
        }
      } catch (err) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('chess-replay-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' && req.method !== 'HEAD') return;
  const here = url.origin === self.location.origin;
  if (req.mode === 'navigate' && here) return e.respondWith(page(req));
  if (here) return e.respondWith(cacheFirst(req));
  if (KEEP_HOSTS.includes(url.hostname) && req.method === 'GET') return e.respondWith(cacheFirst(req));
  // anything else (Hugging Face) goes to the network as usual
});

// the page from the network, kept for next time; offline (or too slow), the kept one
async function page(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then((r) => {
    if (r.ok && r.type === 'basic') cache.put(PAGE, r.clone());
    return r;
  });
  const slow = new Promise((ok) => setTimeout(ok, PAGE_TIMEOUT_MS));
  try {
    const r = await Promise.race([net, slow.then(() => null)]);
    if (r) return r;
  } catch (err) {}
  return (await cache.match(PAGE)) || net;
}

// a kept GET answers a HEAD too (Stockfish checks its file with one), without its body (Firefox refuses one with a body)
async function kept(req) {
  const hit = await (await caches.open(CACHE)).match(req.url, { ignoreVary: true });
  return hit && req.method === 'HEAD' ? new Response(null, { status: hit.status, statusText: hit.statusText, headers: hit.headers }) : hit;
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await kept(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (req.method === 'GET' && (r.ok || r.type === 'opaque')) cache.put(req.url, r.clone()).catch(() => {});
  return r;
}

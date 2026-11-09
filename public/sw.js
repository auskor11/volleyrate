// Keeps the app itself on the device so it opens with no internet (the data is kept by Firestore, saved
// videos by the app). Pages: network first, but after 3 seconds (a weak signal hangs rather than fails) or
// with no connection at all, the saved copy. Built files (/assets/, named by their contents, so they never
// change): saved copy first. Each time a newer version of the app loads, its files are saved and the old ones
// are removed. Google Fonts: saved copy first, so the app looks the same offline.
const CACHE = 'volleyrate-app';
const FONTS = 'volleyrate-fonts';
const PAGE_WAIT = 3000;
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

// every built file this version needs: those in the page, and the ones the main bundle loads later (game page, admin)
async function filesFor(html) {
  const files = new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1]));
  for (const f of [...files].filter(f => f.endsWith('.js'))) {
    const js = await (await fetch(f)).text();
    for (const m of js.matchAll(/assets\/[\w.-]+\.(?:js|css)/g)) files.add('/' + m[0]);
  }
  return [...files];
}

async function saveVersion(html) {
  const c = await caches.open(CACHE);
  const files = await filesFor(html);
  await c.put('/', new Response(html, { headers: { 'Content-Type': 'text/html' } }));
  for (const f of files) if (!(await c.match(f, { ignoreVary: true }))) { try { await c.add(f); } catch { /* next time */ } }
  for (const s of SHELL.slice(1)) if (!(await c.match(s))) { try { await c.add(s); } catch { /* optional */ } }
  // drop built files the current version doesn't use
  const keep = new Set(files);
  for (const req of await c.keys()) {
    const p = new URL(req.url).pathname;
    if (p.startsWith('/assets/') && !keep.has(p)) await c.delete(req);
  }
}

self.addEventListener('install', e => {
  e.waitUntil(fetch('/', { cache: 'no-store' }).then(r => r.text()).then(saveVersion).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith((async () => {
      const hit = await caches.match(req, { cacheName: FONTS });
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok && r.type !== 'opaque') { const c = await caches.open(FONTS); c.put(req, r.clone()); }
      return r;
    })());
    return;
  }
  if (url.origin !== location.origin) return;            // Firestore, YouTube: left alone
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const saved = await caches.match('/', { ignoreVary: true });
      const live = fetch(req).then(async r => {
        if (r.ok && (r.headers.get('content-type') || '').includes('text/html')) await saveVersion(await r.clone().text()).catch(() => {});
        return r;
      });
      e.waitUntil(live.catch(() => {}));  // keep updating the saved copy in the background
      if (saved && self.navigator.onLine === false) return saved;
      const wait = saved ? new Promise(res => setTimeout(() => res(saved), PAGE_WAIT)) : new Promise(() => {});
      try {
        return await Promise.race([live, wait]);
      } catch {
        return saved || new Response('Offline, and this app has not been saved on this device yet.', { status: 503 });
      }
    })());
    return;
  }
  if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) {
    e.respondWith((async () => {
      const hit = await caches.match(req, { ignoreVary: true, ignoreSearch: true });
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok && url.pathname.startsWith('/assets/')) { const c = await caches.open(CACHE); c.put(req, r.clone()); }
      return r;
    })());
  }
});

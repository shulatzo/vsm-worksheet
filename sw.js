// Uygulama kabuğunu önbelleğe alır; internet olmadan da açılır.
// Önce internetteki güncel sürüm denenir. Ağ yoksa ya da 3 saniyede yanıt vermezse önbellekten açılır.
// Maç verisi burada tutulmaz, o tarayıcının IndexedDB'sindedir.
const CACHE = 'vsm-worksheet-v6';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'vsm.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  // cache:'reload' tarayıcının eski HTTP önbelleğini atlar, her zaman güncel dosyayı alır.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const fresh = fetch(req, { cache: 'no-cache' }).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
    e.waitUntil(fresh.catch(() => {}));
    const hit = await cache.match(req, { ignoreSearch: true });
    if (!hit) return fresh;
    return Promise.race([fresh.catch(() => hit), new Promise(r => setTimeout(() => r(hit), 3000))]);
  })());
});

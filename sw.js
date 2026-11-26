// 이탈리아 여행 앱 서비스 워커: 앱 파일·지도 타일·글꼴을 저장해 오프라인에서도 열리게 함
const SHELL_V = 'trip-shell-v5', TILES = 'tiles-v2', FONTS = 'fonts-v1';
const SHELL = ['./', 'index.html', 'data.json', 'manifest.webmanifest',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/leaflet-geoman.min.js', 'vendor/leaflet-geoman.css',
  'vendor/images/marker-icon.png', 'vendor/images/marker-icon-2x.png', 'vendor/images/marker-shadow.png',
  'vendor/images/layers.png', 'vendor/images/layers-2x.png',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const TILE_HOSTS = ['tile.openstreetmap.org', 'tile.openstreetmap.fr'];
const MAX_TILES = 5000;
const SCOPE = new URL('./', self.location).pathname;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![SHELL_V, TILES, FONTS].includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function cacheFirst(cacheName, req, trim) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) { cache.put(req, res.clone()); if (trim) trimCache(cache); }
    return res;
  } catch (err) {
    return hit || Response.error();
  }
}
async function networkFirst(req) {
  const cache = await caches.open(SHELL_V);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('index.html')) || Response.error();
  }
}
async function staleWhileRevalidate(cacheName, req) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}
let trimming = false;
async function trimCache(cache) {
  if (trimming) return; trimming = true;
  try { const keys = await cache.keys(); if (keys.length > MAX_TILES) for (const k of keys.slice(0, keys.length - MAX_TILES)) await cache.delete(k); }
  finally { trimming = false; }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) { e.respondWith(cacheFirst(TILES, req, true)); return; }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { e.respondWith(staleWhileRevalidate(FONTS, req)); return; }
  if (url.origin !== self.location.origin) return;
  // 앱 파일이 아닌 요청(동기화 API 등)은 건드리지 않음
  if (req.headers.has('authorization') || req.cache === 'no-store' || !url.pathname.startsWith(SCOPE)) return;
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/data.json')) { e.respondWith(networkFirst(req)); return; }
  e.respondWith(cacheFirst(SHELL_V, req, false));
});

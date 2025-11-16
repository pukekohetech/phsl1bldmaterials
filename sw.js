// sw.js – Offline-first PWA
const CACHE_NAME = 'phs-materials-v3';
const CORE_ASSETS = [
  './', './index.html', './script.js', './questions.json',
  './manifest.webmanifest', './icon-192.png', './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(Promise.all([self.clients.claim(), caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
  ))]));
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET' || !request.url.startsWith('http')) return;
  e.respondWith(caches.match(request).then(cached => {
    const network = fetch(request).then(r => {
      if (r && r.status === 200) caches.open(CACHE_NAME).then(c => c.put(request, r.clone()));
      return r;
    }).catch(() => cached || caches.match('./index.html'));
    return cached || network;
  }));
});

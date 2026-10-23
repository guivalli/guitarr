/* Service worker do Guitarr Mobile: só guarda a "casca" do app para abrir sem rede.
 * Áudio offline fica no Cache Storage "seer-audio-offline-v1" (gerenciado pelo app); /api, /rest e /auth nunca passam por aqui. */
const SHELL = 'seer-mobile-shell-v2';
const FILES = ['./', './index.html', './manifest.json', '../android-chrome-192x192.png', '../android-chrome-512x512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('seer-mobile-shell-') && k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || /\/(api|rest|auth|share)\//.test(url.pathname)) return;
  if (req.mode === 'navigate') {
    // rede primeiro (sempre a versão nova); sem rede, a cópia guardada
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(SHELL).then((c) => c.put('./index.html', copy)); return r; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});

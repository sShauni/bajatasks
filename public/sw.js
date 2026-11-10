// Service worker mínimo: permite instalar o app e mostra uma tela amigável sem internet.
// Não guarda dados em cache — o app sempre carrega a versão mais nova do servidor.
const OFFLINE = '/offline.html';
self.addEventListener('install', e => {
  e.waitUntil(caches.open('galpao-v1').then(c => c.add(OFFLINE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});

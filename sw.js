/* ============================================================
   DEMO ACCESSIBILITÀ — SERVICE WORKER
   Fa tre cose:
   1. Rende il sito installabile come app (PWA).
   2. Tiene una copia delle pagine visitate, così qualcosa si
      vede anche senza connessione (strategia "prima la rete":
      gli aggiornamenti su GitHub arrivano sempre subito).
   3. Riceve le notifiche push e le mostra (fase 3).
============================================================ */
const CACHE = 'demo-v1';

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

/* Prima la rete, con la copia in cache come paracadute offline */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then((r) => {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia)).catch(() => {});
        return r;
      }).catch(() => caches.match(e.request))
    );
  }
});

/* Notifiche push in arrivo dal Worker (fase 3) */
self.addEventListener('push', (e) => {
  let dati = {};
  try { dati = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil(self.registration.showNotification(
    dati.title || 'Demo Accessibilità',
    {
      body: dati.body || 'Hai delle flashcard da ripassare oggi.',
      icon: 'icons/icon-192.png',
      tag: 'ums-ripasso',
      data: { url: dati.url || './' }
    }
  ));
});

/* Click sulla notifica: porta in primo piano il sito (o lo apre) */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((finestre) => {
      for (const f of finestre) { if ('focus' in f) return f.focus(); }
      return self.clients.openWindow(url);
    })
  );
});

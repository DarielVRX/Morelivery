// ── Precache del shell de la app ──────────────────────────────────────────────
// Lista de assets que se cachean en install. Los archivos con hash (generados
// por Vite) se agregan en runtime via fetch; aquí solo el shell estático.
const SHELL_VERSION = 'v4'; // v4: Stadia Maps tile caching
const SHELL_CACHE   = `morelivery-shell-${SHELL_VERSION}`;
const SHELL_ASSETS  = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/badge.svg',
  '/logo.svg',
];

// ── Background Sync — cola de peticiones offline ──────────────────────────────
// Cuando el conductor pulsa "Entregado" sin señal, la app envía ENQUEUE_REQUEST
// al SW. El SW guarda la petición en Cache Storage y registra el tag de sync.
// En cuanto el dispositivo recupera red, el navegador dispara el evento 'sync'
// y el SW reintenta todas las peticiones encoladas.
const SYNC_QUEUE_KEY = 'morelivery-sync-queue';
const SYNC_TAG       = 'morelivery-status-sync';
const VOICE_CACHE    = 'morelivery-voices-v1';
const VOICE_ASSETS   = [
  '/voices/recordatorio-30s.mp3',
  '/voices/recordatorio-3min.mp3',
];

async function readQueue() {
  try {
    const cache = await caches.open(SYNC_QUEUE_KEY);
    const resp  = await cache.match('queue');
    return resp ? await resp.json() : [];
  } catch { return []; }
}

async function writeQueue(queue) {
  const cache = await caches.open(SYNC_QUEUE_KEY);
  await cache.put('queue', new Response(JSON.stringify(queue), {
    headers: { 'Content-Type': 'application/json' },
  }));
}

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then(cache =>
        cache.addAll(SHELL_ASSETS).catch(() => {})
      ),
      caches.open(VOICE_CACHE).then(cache =>
        cache.addAll(VOICE_ASSETS).catch(() => {})
      ),
    ])
  );
});

// ── Activate: limpiar caches viejos ──────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(keys =>
        Promise.all(
          keys
            .filter(k => k.startsWith('morelivery-shell-') && k !== SHELL_CACHE)
            .map(k => caches.delete(k))
        )
      ),
    ])
  );
});

// ── Tile cache (stale-while-revalidate) ───────────────────────────────────────
const TILES_CACHE   = 'morelivery-tiles-v2';
const TILES_DOMAINS = [
  'tiles.openfreemap.org',
  'tile.openfreemap.org',
  'tiles.stadiamaps.com',
  'tile.stadiamaps.com',
];

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  const API_PREFIXES = ['/nav/', '/orders/', '/drivers/', '/auth/', '/restaurants/', '/users/', '/admin/', '/events', '/api/'];
  if (API_PREFIXES.some(p => url.pathname.startsWith(p))) return;

  if (request.method !== 'GET') return;

  const isTile = TILES_DOMAINS.some(d => url.hostname.includes(d));
  if (isTile) {
    event.respondWith(
      caches.open(TILES_CACHE).then(async cache => {
        const cached = await cache.match(request);
        const fetchPromise = fetch(request).then(res => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        }).catch(() => null);
        return cached || fetchPromise;
      })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok && SHELL_ASSETS.includes(url.pathname)) {
          const clone = response.clone();
          caches.open(SHELL_CACHE).then(c => c.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).then(cached => cached || caches.match('/index.html')))
  );
});

// ── Background Sync ───────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag !== SYNC_TAG) return;

  event.waitUntil(
    (async () => {
      const queue = await readQueue();
      if (!queue.length) return;

      const remaining = [];
      for (const item of queue) {
        try {
          const headers = { 'Content-Type': 'application/json' };
          if (item.token) headers['Authorization'] = `Bearer ${item.token}`;

          const res = await fetch(item.url, {
            method:  item.method || 'PATCH',
            headers,
            body:    item.body ?? undefined,
          });

          // 409 = el pedido ya fue procesado → descartar
          // 2xx = éxito → descartar
          // 5xx / red → reintentar
          if (!res.ok && res.status !== 409) {
            remaining.push(item);
          }
        } catch {
          remaining.push(item);
        }
      }

      await writeQueue(remaining);

      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const synced  = queue.length - remaining.length;
      if (synced > 0) clients.forEach(c => c.postMessage({ type: 'SYNC_COMPLETE', synced }));
    })()
  );
});

// ── Voice playback (desde cache) ──────────────────────────────────────────────
async function playVoice(voiceName) {
  try {
    const cache    = await caches.open(VOICE_CACHE);
    const response = await cache.match(`/voices/${voiceName}.mp3`);
    if (!response) { console.warn(`Voz no encontrada: ${voiceName}`); return; }
    const blob = await response.blob();
    const url  = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
    audio.onended = () => URL.revokeObjectURL(url);
  } catch (e) { console.warn('Voice play error:', e); }
}

// ── Notificaciones agrupadas ──────────────────────────────────────────────────
const notifCounts = {};

async function showGroupedNotification({ group, title, body, url, priority, tag, vibrate }) {
  if (!notifCounts[group]) notifCounts[group] = { count: 0, lastBody: '', url };
  notifCounts[group].count++;
  notifCounts[group].lastBody = body;
  notifCounts[group].url = url;

  const { count, lastBody } = notifCounts[group];
  const isHigh = priority === 'high';

  const displayTitle = count > 1 ? `${title} (${count})` : title;
  const displayBody  = count > 1 ? `${lastBody} — y ${count - 1} más` : lastBody;

  const existing = await self.registration.getNotifications({ tag });
  existing.forEach(n => n.close());

  const vibratePattern = vibrate || (isHigh ? [300, 100, 300, 100, 300] : [200, 100, 200]);

  await self.registration.showNotification(displayTitle, {
    body:               displayBody,
    tag,
    icon:               '/icon-192.png',
    badge:              '/badge.svg',
    requireInteraction: isHigh,
    renotify:           true,
    timestamp:          Date.now(),
    vibrate:            vibratePattern,
    actions:            [{ action: 'open', title: 'Abrir' }],
    data:               { url, group },
  });
}

// ── Mensajes desde la app (postMessage) ───────────────────────────────────────
self.addEventListener('message', (event) => {
  const type = event.data?.type;

  // ── Existentes ──────────────────────────────────────────────────────────────

  if (type === 'TEST_NOTIFICATION') {
    const { title = 'Morelivery', body = 'Notificación de prueba ✓', tag = 'test' } = event.data;
    notifCounts[tag] = { count: 0, lastBody: '', url: '/' };
    showGroupedNotification({ group: tag, title, body, url: '/', priority: 'high', tag });
    return;
  }

  if (type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, group, url = '/', priority = 'normal', data } = event.data;
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const anyFocused = clients.some(c => c.focused);
      if (anyFocused) return;
      const resolvedGroup = group || tag || 'general';
      showGroupedNotification({
        group: resolvedGroup, title, body,
        url: data?.url || url, priority, tag: resolvedGroup,
      }).then(() => {
        if ('setAppBadge' in self) {
          const total = Object.values(notifCounts).reduce((s, v) => s + v.count, 0);
          self.setAppBadge(total).catch(() => {});
        }
      });
    });
    return;
  }

  if (type === 'ENQUEUE_REQUEST') {
    const { url, method, body, token } = event.data;
    (async () => {
      const queue = await readQueue();
      queue.push({ url, method, body, token, ts: Date.now() });
      await writeQueue(queue);
      try { await self.registration.sync.register(SYNC_TAG); } catch { /* API no disponible */ }
    })();
    return;
  }

  if (type === 'APP_FOCUSED') {
    Object.keys(notifCounts).forEach(k => { notifCounts[k].count = 0; });
    if ('clearAppBadge' in self) self.clearAppBadge().catch(() => {});
    return;
  }

  // ── Nuevos ──────────────────────────────────────────────────────────────────

  // VIBRATE: la app puede pedir vibración desde background via postMessage
  // Útil cuando el SW recibe un push y quiere patrones más complejos que el
  // campo `vibrate` de showNotification (ej. pulsos encadenados con delay).
  //
  // Uso: reg.active.postMessage({ type: 'VIBRATE', pattern: [300, 100, 300] })
  //
  // Nota: navigator.vibrate() solo funciona en el contexto de window, no en SW.
  // Este handler reenvía el mensaje a todas las ventanas abiertas para que
  // ejecuten la vibración. Si la app está en background, la vibración viene
  // del campo `vibrate` de la notificación push directamente.
  if (type === 'VIBRATE') {
    const { pattern = [200] } = event.data;
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      clients.forEach(c => c.postMessage({ type: 'VIBRATE_EXECUTE', pattern }));
    });
    return;
  }

  // SYNC_STATUS_UPDATE: variante tipada de ENQUEUE_REQUEST para actualizaciones
  // de estado de pedido. Separa semánticamente el tipo de cola para que el
  // backend pueda diferenciar qué endpoint llamar al reenviar.
  //
  // Campos: orderId, status, token, extra (objeto libre)
  // El SW construye la URL y el body antes de encolar.
  if (type === 'SYNC_STATUS_UPDATE') {
    const { orderId, status, token, extra = {} } = event.data;
    (async () => {
      const queue = await readQueue();
      queue.push({
        url:    `/api/orders/${orderId}/status`,
        method: 'PATCH',
        body:   JSON.stringify({ status, ...extra }),
        token,
        ts:     Date.now(),
        kind:   'status_update',  // para logging/analytics en el backend
      });
      await writeQueue(queue);
      try { await self.registration.sync.register(SYNC_TAG); } catch { /* ok */ }
    })();
    return;
  }

  // SYNC_LOCATION_BATCH: encola un lote de pings de GPS acumulados offline.
  // La app va guardando posiciones en localStorage mientras no hay red,
  // y las manda todas en un solo mensaje cuando detecta que volvió la señal
  // o cuando el SW se despierta por sync.
  //
  // Campos: driverId, positions (array de { lat, lng, ts }), token
  if (type === 'SYNC_LOCATION_BATCH') {
    const { driverId, positions, token } = event.data;
    if (!positions?.length) return;
    (async () => {
      const queue = await readQueue();
      queue.push({
        url:    `/api/drivers/${driverId}/location-batch`,
        method: 'POST',
        body:   JSON.stringify({ positions }),
        token,
        ts:     Date.now(),
        kind:   'location_batch',
      });
      await writeQueue(queue);
      try { await self.registration.sync.register(SYNC_TAG); } catch { /* ok */ }
    })();
    return;
  }
});

// ── Web Push (VAPID) ──────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: 'Morelivery', body: event.data.text() }; }

  const {
    title    = 'Morelivery',
    body     = '',
    tag      = 'general',
    group    = tag,
    url      = '/',
    priority = 'normal',
    vibrate,
  } = payload;

  event.waitUntil(
    showGroupedNotification({ group, title, body, url, priority, tag: group, vibrate })
  );
});

// ── Click en notificación ─────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const group = event.notification.data?.group;
  if (group && notifCounts[group]) notifCounts[group].count = 0;

  if ('clearAppBadge' in self) self.clearAppBadge().catch(() => {});

  const targetUrl = event.notification?.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.navigate(targetUrl).then(() => existing.focus());
      return self.clients.openWindow(targetUrl);
    })
  );
});

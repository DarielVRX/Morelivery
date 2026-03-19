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
//
// Se usa Cache Storage como key-value store liviano — evita añadir una dependencia
// de IndexedDB y está disponible en el mismo contexto que los demás caches.
const SYNC_QUEUE_KEY = 'morelivery-sync-queue';
const SYNC_TAG       = 'morelivery-status-sync';

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


self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      cache.addAll(SHELL_ASSETS).catch(() => {
        // Si algún asset falla (ej. logo.svg grande), continuar igual
      })
    )
  );
});

// ── Activar: limpiar caches viejos ────────────────────────────────────────
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

// ── Caché de tiles vectoriales (stale-while-revalidate) ───────────────────────
const TILES_CACHE   = 'morelivery-tiles-v2'; // v2: adds Stadia Maps
const TILES_DOMAINS = [
  'tiles.openfreemap.org',
  'tile.openfreemap.org',
  'tiles.stadiamaps.com',    // Stadia vector tiles
  'tile.stadiamaps.com',     // Stadia raster fallback
];

// ── IndexedDB para última ruta/destino/posición ────────────────────────────────
// Usado por el frontend para persistir contexto de navegación entre sesiones.
// El SW no escribe aquí — solo gestiona el caché de tiles.
// La app escribe directamente con indexedDB.open('morelivery-nav', 1).

// ── Fetch: shell-first para navegación, network-first para API ────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API y SSE: nunca cachear — siempre red
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/events')) return;

  // Solo GET
  if (request.method !== 'GET') return;

  // Tiles vectoriales: stale-while-revalidate
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

  // Estrategia: red primero, fallback a caché (shell assets)
  // Para assets con hash (JS/CSS de Vite), la red siempre gana.
  // Si offline, el caché entrega el shell para que React pueda montar.
  event.respondWith(
    fetch(request)
      .then(response => {
        // Cachear respuestas del shell en runtime
        if (response.ok && SHELL_ASSETS.includes(url.pathname)) {
          const clone = response.clone();
          caches.open(SHELL_CACHE).then(c => c.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).then(cached => cached || caches.match('/index.html')))
  );
});

// ── Background Sync — reenvío de peticiones al recuperar red ─────────────────
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

          // 409 Conflict = el pedido ya fue procesado por otro medio → descartar
          // 2xx = éxito → descartar
          // Cualquier otro error de servidor (5xx) o red → reintentar
          if (!res.ok && res.status !== 409) {
            remaining.push(item);
          }
        } catch {
          // Sin red todavía — volver a encolar
          remaining.push(item);
        }
      }

      await writeQueue(remaining);

      // Avisar a la app si está abierta para que refresque datos
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const synced  = queue.length - remaining.length;
      if (synced > 0) clients.forEach(c => c.postMessage({ type: 'SYNC_COMPLETE', synced }));
    })()
  );
});


// Mantener conteo acumulado de notificaciones no vistas por categoría.
// Cuando llega una nueva del mismo tag-group, se reemplaza la notificación
// existente (mismo tag) con un resumen actualizado en lugar de apilar.
const notifCounts = {};  // { [group]: { count, lastBody, url } }

async function showGroupedNotification({ group, title, body, url, priority, tag }) {
  if (!notifCounts[group]) notifCounts[group] = { count: 0, lastBody: '', url };
  notifCounts[group].count++;
  notifCounts[group].lastBody = body;
  notifCounts[group].url = url;

  const { count, lastBody } = notifCounts[group];
  const isHigh = priority === 'high';

  // Si hay más de 1 notificación del mismo grupo, mostrar resumen
  const displayTitle = count > 1 ? `${title} (${count})` : title;
  const displayBody  = count > 1
    ? `${lastBody} — y ${count - 1} más`
    : lastBody;

  // Cerrar notificación anterior del mismo grupo antes de mostrar la nueva
  const existing = await self.registration.getNotifications({ tag });
  existing.forEach(n => n.close());

  await self.registration.showNotification(displayTitle, {
    body:              displayBody,
    tag,               // mismo tag = reemplaza la anterior del grupo
    icon:              '/icon-192.png',
    badge:             '/badge.svg',
    requireInteraction: isHigh,
    renotify:          true,   // vibrar/sonar aunque el tag sea el mismo
    silent:            false,
    timestamp:         Date.now(),
    vibrate:           isHigh ? [300, 100, 300, 100, 300] : [200, 100, 200],
    actions:           [{ action: 'open', title: 'Abrir' }],
    data:              { url, group },
  });
}

// ── Mensajes desde la app (postMessage) ──────────────────────────────────────
// Un solo handler para todos los tipos de mensaje — evita que se pisen.
self.addEventListener('message', (event) => {
  const type = event.data?.type;

  // SHOW_NOTIFICATION: notificación SSE desde foreground
  if (type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, group, url = '/', priority = 'normal', data } = event.data;

    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const anyFocused = clients.some(c => c.focused);
      if (anyFocused) return; // App en primer plano — el UI ya muestra la info

      const resolvedGroup = group || tag || 'general';
      showGroupedNotification({
        group:    resolvedGroup,
        title,
        body,
        url:      data?.url || url,
        priority,
        tag:      resolvedGroup,
      }).then(() => {
        // Actualizar badge del ícono de la app
        if ('setAppBadge' in self) {
          const total = Object.values(notifCounts).reduce((s, v) => s + v.count, 0);
          self.setAppBadge(total).catch(() => {});
        }
      });
    });
    return;
  }

  // ENQUEUE_REQUEST: conductor tomó acción sin señal (ej. marcó entregado offline).
  // La app detecta el error de red y delega al SW para garantizar la entrega.
  if (type === 'ENQUEUE_REQUEST') {
    const { url, method, body, token } = event.data;
    (async () => {
      const queue = await readQueue();
      queue.push({ url, method, body, token, ts: Date.now() });
      await writeQueue(queue);
      // Registrar sync tag — el navegador nos despertará cuando haya red
      try { await self.registration.sync.register(SYNC_TAG); } catch { /* API no disponible */ }
    })();
    return;
  }

  // APP_FOCUSED: el usuario abrió la app — limpiar badge y contadores
  if (type === 'APP_FOCUSED') {
    Object.keys(notifCounts).forEach(k => { notifCounts[k].count = 0; });
    if ('clearAppBadge' in self) self.clearAppBadge().catch(() => {});
    return;
  }
});

// ── Web Push nativo (VAPID) ───────────────────────────────────────────────
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
  } = payload;

  event.waitUntil(
    showGroupedNotification({ group, title, body, url, priority, tag: group })
  );
});

// ── Click en notificación ─────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Resetear el conteo del grupo al abrir
  const group = event.notification.data?.group;
  if (group && notifCounts[group]) notifCounts[group].count = 0;

  // Limpiar badge al abrir cualquier notificación
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

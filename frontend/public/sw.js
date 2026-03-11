// ── Precache del shell de la app ──────────────────────────────────────────────
// Lista de assets que se cachean en install. Los archivos con hash (generados
// por Vite) se agregan en runtime via fetch; aquí solo el shell estático.
const SHELL_VERSION = 'v1'; // incrementar manualmente al desplegar cambios de shell
const SHELL_CACHE   = `morelivery-shell-${SHELL_VERSION}`;
const SHELL_ASSETS  = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.svg',
  '/icon-512.svg',
  '/badge.svg',
  '/logo.svg',
];

// ── Instalar: cachear el shell ─────────────────────────────────────────────
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

// ── Fetch: shell-first para navegación, network-first para API ────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API y SSE: nunca cachear — siempre red
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/events')) return;

  // Solo GET
  if (request.method !== 'GET') return;

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

// ── Contador por categoría en el SW ──────────────────────────────────────────
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
    icon:              '/icon-192.svg',
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



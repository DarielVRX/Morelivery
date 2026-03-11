self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// ── Notificaciones via postMessage (SSE foreground → SW) ─────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, data, url } = event.data;
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const anyFocused = clients.some(c => c.focused);
      if (!anyFocused) {
        self.registration.showNotification(title, {
          body,
          tag: tag || 'morelivery',
          icon: '/logo.svg',
          badge: '/logo.svg',
          requireInteraction: true,
          renotify: true,
          silent: false,
          vibrate: [200, 100, 200],
          data: data || { url: url || '/' },
        });
      }
    });
  }
});

// ── Web Push nativo (VAPID) — listo para cuando se implemente ─────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: 'Morelivery', body: event.data.text() }; }

  const { title = 'Morelivery', body = '', tag = 'morelivery', url = '/' } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: '/logo.svg',
      badge: '/logo.svg',
      requireInteraction: true,
      renotify: true,
      silent: false,
      vibrate: [200, 100, 200],
      data: { url },
    })
  );
});

// ── Click en notificación ─────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) {
        return existing.navigate(targetUrl).then(() => existing.focus());
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

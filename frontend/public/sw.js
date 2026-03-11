self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// ── Notificaciones via postMessage (SSE foreground → SW) ─────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, data, url, priority = 'normal' } = event.data;
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const anyFocused = clients.some(c => c.focused);
      if (!anyFocused) {
        const isHigh = priority === 'high';
        self.registration.showNotification(title, {
          body,
          tag: tag || 'morelivery',
          icon: '/icon-192.svg',
          badge: '/badge.svg',
          image: '/icon-512.svg',
          requireInteraction: isHigh,
          renotify: true,
          silent: false,
          timestamp: Date.now(),
          actions: [
            { action: 'open', title: 'Abrir' },
          ],
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

  const { title = 'Morelivery', body = '', tag = 'morelivery', url = '/', priority = 'normal' } = payload;
  const isHigh = priority === 'high';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: '/icon-192.svg',
      badge: '/badge.svg',
      image: '/icon-512.svg',
      requireInteraction: isHigh,
      renotify: true,
      silent: false,
      timestamp: Date.now(),
      actions: [
        { action: 'open', title: 'Abrir' },
      ],
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

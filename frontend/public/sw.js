self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// Mostrar notificación desde el SW (para móvil: barra de estado + pantalla de bloqueo)
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || '🛵 Nueva oferta', {
        body:             data.body,
        icon:             '/logo.svg',
        badge:            '/logo.svg',
        tag:              data.tag || 'offer',
        renotify:         true,
        requireInteraction: true,
        vibrate:          [200, 100, 200],
        data:             data.data || {},
      })
    );
  } catch (_) {}
});

// Click en notificación → enfocar o abrir la app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si ya hay una ventana abierta, enfocarla
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      // Si no, abrir una nueva
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});

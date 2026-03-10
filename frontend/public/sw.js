self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// Recibir mensaje del cliente principal para mostrar notificación
// cuando la app está en segundo plano o la pantalla apagada.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag } = event.data;
    // Solo mostrar si ninguna ventana de la app está en foco
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const anyFocused = clients.some(c => c.focused);
      if (!anyFocused) {
        self.registration.showNotification(title, {
          body,
          tag: tag || 'morelivery',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          requireInteraction: true,
          vibrate: [200, 100, 200],
        });
      }
    });
  }
});

// Click en notificación → enfocar la app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        self.clients.openWindow('/');
      }
    })
  );
});

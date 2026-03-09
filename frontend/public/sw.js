self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// Click en notificación → abrir/enfocar la app en /driver
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : 'https://morelivery.vercel.app/driver';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Buscar ventana ya abierta con esa URL
      for (const client of clients) {
        if (client.url.includes('/driver') && 'focus' in client) {
          return client.focus();
        }
      }
      // Buscar cualquier ventana abierta y navegar
      for (const client of clients) {
        if ('navigate' in client) return client.navigate(targetUrl).then(c => c?.focus());
      }
      // Abrir nueva ventana
      return self.clients.openWindow(targetUrl);
    })
  );
});

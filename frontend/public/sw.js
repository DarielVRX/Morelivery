// frontend/public/sw.js
// FIX aplicado:
//   - Acción 'open_restaurant' manejada en notificationclick.
//     Antes el SW nunca la procesaba — el restaurante tocaba "Abrir"
//     y no pasaba nada. Ahora envía NOTIFICATION_ACTION al cliente
//     para que el listener en React llame PATCH /restaurants/my/toggle.

const SHELL_VERSION = 'v6';
const ROUTER_BRAND = 'encorto';
const UI_BRAND = 'En Corto';

const SHELL_CACHE   = `${ROUTER_BRAND}-shell-${SHELL_VERSION}`;
const SHELL_ASSETS  = [
  '/', '/index.html', '/manifest.webmanifest',
  '/icon-192.png', '/icon-512.png', '/badge.svg', '/logo.svg',
];

const SYNC_QUEUE_KEY = `${ROUTER_BRAND}-sync-queue`;
const SYNC_TAG       = `${ROUTER_BRAND}-status-sync`;
const VOICE_CACHE    = `${ROUTER_BRAND}-voices-v1`;
const VOICE_ASSETS   = [
  '/voices/recordatorio-30s.mp3',
  '/voices/recordatorio-3min.mp3',
];

// ── Timers de repetición para pedidos de restaurante ─────────────────────────
const orderRepeatTimers = new Map(); // orderId → intervalId

// ── Patrones de vibración por tipo ───────────────────────────────────────────
const VIBRATE = {
  offer:     [500,100,500,100,500,100,500],
  new_order: [500,150,500,150,500],
  call:      [500,300,500,300,500,300,500,300,500,300,500,300,500],
  cancel:    [200, 100, 200],
  eta:       [150, 80, 150],
  arrived:   [300, 100, 100, 100, 300],
  support:   [200, 100, 200],
  normal:    [200, 100, 200],
};

// ── Queue ─────────────────────────────────────────────────────────────────────
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
      caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS).catch(() => {})),
      caches.open(VOICE_CACHE).then(cache => cache.addAll(VOICE_ASSETS).catch(() => {})),
    ])
  );
});

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(keys =>
        Promise.all(
          keys.filter(k => k.startsWith(`${ROUTER_BRAND}-shell-`) && k !== SHELL_CACHE)
              .map(k => caches.delete(k))
        )
      ),
    ])
  );
});

// ── Tile cache ────────────────────────────────────────────────────────────────
const TILES_CACHE   = `${ROUTER_BRAND}-tiles-v2`;
const TILES_DOMAINS = [
  'tiles.openfreemap.org', 'tile.openfreemap.org',
  'tiles.stadiamaps.com',  'tile.stadiamaps.com',
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
        const cached      = await cache.match(request);
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
  event.waitUntil((async () => {
    const queue     = await readQueue();
    if (!queue.length) return;
    const remaining = [];
    for (const item of queue) {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (item.token) headers['Authorization'] = `Bearer ${item.token}`;
        const res = await fetch(item.url, { method: item.method || 'PATCH', headers, body: item.body ?? undefined });
        if (!res.ok && res.status !== 409) remaining.push(item);
      } catch { remaining.push(item); }
    }
    await writeQueue(remaining);
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const synced  = queue.length - remaining.length;
    if (synced > 0) clients.forEach(c => c.postMessage({ type: 'SYNC_COMPLETE', synced }));
  })());
});

// ── Voice ─────────────────────────────────────────────────────────────────────
async function playVoice(voiceName) {
  try {
    const cache    = await caches.open(VOICE_CACHE);
    const response = await cache.match(`/voices/${voiceName}.mp3`);
    if (!response) return;
    const blob  = await response.blob();
    const url   = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
    audio.onended = () => URL.revokeObjectURL(url);
  } catch (_) {}
}

// ── Notificaciones agrupadas ──────────────────────────────────────────────────
const notifCounts = {};

async function showGroupedNotification({
  group, title, body, url, priority, tag, vibrate, actions, requireInteraction: forceRequire,
}) {
  if (!notifCounts[group]) notifCounts[group] = { count: 0, lastBody: '', url };
  notifCounts[group].count++;
  notifCounts[group].lastBody = body;
  notifCounts[group].url      = url;

  const { count, lastBody } = notifCounts[group];
  const isHigh = priority === 'high';

  const displayTitle = count > 1 ? `${title} (${count})` : title;
  const displayBody  = count > 1 ? `${lastBody} — y ${count - 1} más` : lastBody;

  const existing = await self.registration.getNotifications({ tag });
  existing.forEach(n => n.close());

  const vibratePattern = vibrate || (isHigh ? VIBRATE.normal : [180, 80, 180]);

  await self.registration.showNotification(displayTitle, {
    body:               displayBody,
    tag,
    icon:               '/icon-192.png',
    badge:              '/badge.svg',
    requireInteraction: forceRequire ?? isHigh,
    renotify:           true,
    timestamp:          Date.now(),
    vibrate:            vibratePattern,
    actions:            actions || [],
    data:               { url, group },
  });
}

// ── Notificación tipo llamada ─────────────────────────────────────────────────
async function showCallNotification({ orderId, driverName, url }) {
  const existing = await self.registration.getNotifications({ tag: `call_${orderId}` });
  existing.forEach(n => n.close());

  await self.registration.showNotification('📞 Llamada entrante', {
    body:               `${driverName || 'Tu repartidor'} está intentando localizarte, por favor revisa el chat`,
    tag:                `call_${orderId}`,
    icon:               '/icon-192.png',
    badge:              '/badge.svg',
    requireInteraction: true,
    renotify:           true,
    timestamp:          Date.now(),
    vibrate:            VIBRATE.call,
    silent:             false,
    data:               { url: url || '/', group: 'calls', isCall: true, driverName },
  });
}

// ── Mensajes desde la app (postMessage) ───────────────────────────────────────
self.addEventListener('message', (event) => {
  const type = event.data?.type;

  if (type === 'TEST_NOTIFICATION') {
    const { title = UI_BRAND, body = 'Notificación de prueba ✓', tag = 'test' } = event.data;
    notifCounts[tag] = { count: 0, lastBody: '', url: '/' };
    showGroupedNotification({ group: tag, title, body, url: '/', priority: 'high', tag });
    return;
  }

  if (type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, group, url = '/', priority = 'normal', vibrate, actions, data } = event.data;
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const anyFocused = clients.some(c => c.focused);
      if (anyFocused) return;
      const resolvedGroup = group || tag || 'general';
      showGroupedNotification({
        group: resolvedGroup, title, body,
        url: data?.url || url, priority, tag: resolvedGroup, vibrate, actions,
      }).then(() => {
        if ('setAppBadge' in self) {
          const total = Object.values(notifCounts).reduce((s, v) => s + v.count, 0);
          self.setAppBadge(total).catch(() => {});
        }
      });
    });
    return;
  }

  if (type === 'SHOW_CALL_NOTIFICATION') {
    const { orderId, driverName, url } = event.data;
    showCallNotification({ orderId, driverName, url });
    return;
  }

  if (type === 'CANCEL_ORDER_REPEAT') {
    const { orderId } = event.data;
    const timer = orderRepeatTimers.get(orderId);
    if (timer) { clearInterval(timer); orderRepeatTimers.delete(orderId); }
    return;
  }

  if (type === 'ENQUEUE_REQUEST') {
    const { url, method, body, token } = event.data;
    (async () => {
      const queue = await readQueue();
      queue.push({ url, method, body, token, ts: Date.now() });
      await writeQueue(queue);
      try { await self.registration.sync.register(SYNC_TAG); } catch {}
    })();
    return;
  }

  if (type === 'APP_FOCUSED') {
    Object.keys(notifCounts).forEach(k => { notifCounts[k].count = 0; });
    if ('clearAppBadge' in self) self.clearAppBadge().catch(() => {});
    for (const [id, timer] of orderRepeatTimers) {
      clearInterval(timer);
      orderRepeatTimers.delete(id);
    }
    return;
  }

  if (type === 'VIBRATE') {
    const { pattern = [200] } = event.data;
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      clients.forEach(c => c.postMessage({ type: 'VIBRATE_EXECUTE', pattern }));
    });
    return;
  }

  if (type === 'SYNC_STATUS_UPDATE') {
    const { orderId, status, token, extra = {} } = event.data;
    (async () => {
      const queue = await readQueue();
      queue.push({
        url: `/api/orders/${orderId}/status`, method: 'PATCH',
        body: JSON.stringify({ status, ...extra }), token, ts: Date.now(), kind: 'status_update',
      });
      await writeQueue(queue);
      try { await self.registration.sync.register(SYNC_TAG); } catch {}
    })();
    return;
  }

  if (type === 'SYNC_LOCATION_BATCH') {
    const { driverId, positions, token } = event.data;
    if (!positions?.length) return;
    (async () => {
      const queue = await readQueue();
      queue.push({
        url: `/api/drivers/${driverId}/location-batch`, method: 'POST',
        body: JSON.stringify({ positions }), token, ts: Date.now(), kind: 'location_batch',
      });
      await writeQueue(queue);
      try { await self.registration.sync.register(SYNC_TAG); } catch {}
    })();
    return;
  }
});

// ── Web Push (VAPID) ──────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: UI_BRAND, body: event.data.text() }; }

  const {
    title    = UI_BRAND,
    body     = '',
    tag      = 'general',
    group    = tag,
    url      = '/',
    priority = 'normal',
    vibrate,
    actions,
    type: pushType,
    orderId,
    driverName,
  } = payload;

  event.waitUntil((async () => {
    if (pushType === 'simulated_call') {
      await showCallNotification({ orderId, driverName, url });
      return;
    }

    if (pushType === 'new_order' && orderId) {
      await showGroupedNotification({
        group: 'kitchen', title, body, url, priority: 'high',
        tag: `new_order_${orderId}`, vibrate: VIBRATE.new_order,
        actions: [{ action: 'confirm', title: '✓ Confirmar' }],
      });

      const existing = orderRepeatTimers.get(orderId);
      if (existing) clearInterval(existing);

      const timer = setInterval(async () => {
        const notifs = await self.registration.getNotifications({ tag: `new_order_${orderId}` });
        if (notifs.length === 0) {
          clearInterval(timer);
          orderRepeatTimers.delete(orderId);
          return;
        }
        await showGroupedNotification({
          group: 'kitchen', title: '⚠️ Pedido sin confirmar', body,
          url, priority: 'high', tag: `new_order_${orderId}`,
          vibrate: VIBRATE.new_order,
          actions: [{ action: 'confirm', title: '✓ Confirmar' }],
        });
      }, 3 * 60 * 1000);

      orderRepeatTimers.set(orderId, timer);
      return;
    }

    if (group === 'driver' || pushType === 'new_offer') {
      // Guard: si la app está abierta Y enfocada, el SSE ya manejó la oferta.
      // En Android PWA, focused puede ser false aunque la app esté visible —
      // usamos visibilityState vía clients para ser más precisos.
      const activeClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const anyFocused = activeClients.some(c => c.focused && c.visibilityState === 'visible');
      if (anyFocused) return;

      await showGroupedNotification({
        group: 'driver', title, body, url, priority: 'high',
        tag: group, vibrate: VIBRATE.offer,
        requireInteraction: true,
        actions: [
          { action: 'accept', title: '✓ Aceptar' },
          { action: 'reject', title: '✕ Rechazar' },
        ],
      });
      return;
    }

    // route_update es SSE-first — el push solo llega si la app está cerrada.
    // En ese caso simplemente abrir la app; el SSE sincronizará al reconectar.
    if (pushType === 'route_update') {
      // No mostrar notificación visible — solo despertar la app si está en background
      return;
    }

    if (pushType === 'dispute_cancelled_auto') {
      await showGroupedNotification({
        group: 'driver', title, body, url, priority: 'normal',
        tag: `dispute_${orderId || Date.now()}`, vibrate: VIBRATE.normal,
      });
      return;
    }

    if (pushType === 'cancelled' || pushType === 'reassigned') {
      await showGroupedNotification({
        group: 'driver', title, body, url, priority: 'high',
        tag: `cancel_${orderId || Date.now()}`, vibrate: VIBRATE.cancel,
      });
      return;
    }

    if (pushType === 'driver_eta_alert') {
      await showGroupedNotification({
        group: 'customer', title, body, url, priority: 'normal',
        tag: `eta_${orderId}`, vibrate: VIBRATE.eta,
        actions: [{ action: 'message', title: '💬 Enviar mensaje' }],
      });
      return;
    }

    if (pushType === 'driver_arrived') {
      await showGroupedNotification({
        group: 'customer', title, body, url, priority: 'high',
        tag: `arrived_${orderId}`, vibrate: VIBRATE.arrived,
        actions: [{ action: 'message', title: '💬 Enviar mensaje' }],
      });
      return;
    }

    if (pushType === 'chat_message') {
      await showGroupedNotification({
        group: 'chat', title, body, url, priority: 'normal',
        tag: `chat_${orderId || Date.now()}`, vibrate: VIBRATE.support,
        actions: [{ action: 'message', title: '💬 Abrir chat' }],
      });
      return;
    }

    await showGroupedNotification({ group, title, body, url, priority, tag: group, vibrate, actions });
  })());
});

// ── Click en notificación ─────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const group   = event.notification.data?.group;
  const isCall  = event.notification.data?.isCall;
  const action  = event.action;

  if (group && notifCounts[group]) notifCounts[group].count = 0;
  if ('clearAppBadge' in self) self.clearAppBadge().catch(() => {});

  // FIX: acción 'open_restaurant' — antes no se manejaba, el botón no hacía nada.
  // Ahora envía NOTIFICATION_ACTION al cliente. El listener en React
  // (Schedule.jsx o hook global) debe llamar PATCH /restaurants/my/toggle { override: true }.
  if (action === 'open_restaurant') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        const messageData = {
          type: 'NOTIFICATION_ACTION',
          action: 'open_restaurant',
          data: event.notification.data,
        };
        const existing = clients.find(c => c.url.includes(self.location.origin));
        if (existing) {
          existing.postMessage(messageData);
          return existing.focus();
        }
        return self.clients.openWindow(event.notification.data?.url || '/restaurant/horario').then(client => {
          if (client) {
            setTimeout(() => client.postMessage(messageData), 1200);
          }
        });
      })
    );
    return;
  }

  // 'ignore_reminder' — cerrar sin acción
  if (action === 'ignore_reminder') return;

  // keep_waiting — cliente confirma que quiere seguir esperando driver
  if (action === 'keep_waiting') {
    const orderId = event.notification.data?.orderId;
    if (orderId) {
      event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
          const existing = clients.find(c => c.url.includes(self.location.origin));
          if (existing) {
            existing.postMessage({ type: 'NOTIFICATION_ACTION', action: 'keep_waiting', data: { orderId } });
            return existing.focus();
          }
          return self.clients.openWindow('/customer/pedidos').then(client => {
            if (client) setTimeout(() => client.postMessage({ type: 'NOTIFICATION_ACTION', action: 'keep_waiting', data: { orderId } }), 1000);
          });
        })
      );
    }
    return;
  }

  // cancel_order — cliente cancela desde notificación push
  if (action === 'cancel_order') {
    const orderId = event.notification.data?.orderId;
    if (orderId) {
      event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
          const existing = clients.find(c => c.url.includes(self.location.origin));
          if (existing) {
            existing.postMessage({ type: 'NOTIFICATION_ACTION', action: 'cancel_order', data: { orderId } });
            return existing.focus();
          }
          return self.clients.openWindow('/customer/pedidos').then(client => {
            if (client) setTimeout(() => client.postMessage({ type: 'NOTIFICATION_ACTION', action: 'cancel_order', data: { orderId } }), 1000);
          });
        })
      );
    }
    return;
  }

  // Acciones existentes — accept, reject, confirm
  if (action === 'accept' || action === 'reject' || action === 'confirm') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        const existing = clients.find(c => c.url.includes(self.location.origin));
        if (existing) {
          existing.postMessage({ type: 'NOTIFICATION_ACTION', action, data: event.notification.data });
          return existing.focus();
        }
        return self.clients.openWindow(event.notification.data?.url || '/').then(client => {
          if (client) {
            setTimeout(() => client.postMessage({ type: 'NOTIFICATION_ACTION', action, data: event.notification.data }), 1000);
          }
        });
      })
    );
    return;
  }

  if (action === 'close_restaurant') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        const messageData = {
          type: 'NOTIFICATION_ACTION',
          action: 'close_restaurant',
          data: event.notification.data,
        };
        const existing = clients.find(c => c.url.includes(self.location.origin));
        if (existing) {
          existing.postMessage(messageData);
          return existing.focus();
        }
        return self.clients.openWindow(event.notification.data?.url || '/restaurant/horario').then(client => {
          if (client) setTimeout(() => client.postMessage(messageData), 1200);
        });
      })
    );
    return;
  }

  // Toque en la notificación (no en un botón) — abrir la app
  const targetUrl = event.notification?.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      if (isCall) {
        const driverName = event.notification.data?.driverName || 'Tu repartidor';
        const client = clients.find(c => c.url.includes(self.location.origin));
        if (client) {
          client.postMessage({ type: 'SPEAK', text: `${driverName} está intentando localizarte` });
          return client.navigate(targetUrl).then(() => client.focus());
        }
        return self.clients.openWindow(targetUrl).then(newClient => {
          if (newClient) {
            setTimeout(() => newClient.postMessage({
              type: 'SPEAK', text: `${driverName} está intentando localizarte`,
            }), 800);
          }
        });
      }

      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.navigate(targetUrl).then(() => existing.focus());
      return self.clients.openWindow(targetUrl);
    })
  );
});

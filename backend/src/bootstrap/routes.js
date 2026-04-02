// backend/bootstrap/routes.js
import authRoutes        from '../modules/auth/routes.js';
import restaurantRoutes  from '../modules/restaurants/routes.js';
import orderRoutes       from '../modules/orders/routes.js';
import driverRoutes      from '../modules/drivers/routes.js';
import adminRoutes       from '../modules/admin/routes.js';
import eventRoutes       from '../modules/events/routes.js';
import routeModelRoutes  from '../modules/routes/routes.js';
import paymentsRoutes    from '../modules/payments/routes.js';
import navZonesRoutes    from '../modules/nav/zones.js';
import navRoadPrefsRoutes from '../modules/nav/road-prefs.js';
import navMapMatchRoutes  from '../modules/nav/map-match.js';
// ── Nuevos módulos PWA ────────────────────────────────────────────────────────
import syncRoutes        from '../modules/sync/routes.js';
import voiceRoutes       from '../modules/voice/routes.js';
// FIX: support no estaba registrado → POST /api/support/tickets devolvía 404
import supportRoutes     from '../modules/support/routes.js';
import pushRoutes        from '../modules/push/routes.js';

const routeRegistry = [
  ['auth',           authRoutes],
  ['restaurants',    restaurantRoutes],
  ['orders',         orderRoutes],
  ['drivers',        driverRoutes],
  ['admin',          adminRoutes],
  ['events',         eventRoutes],
  ['routes',         routeModelRoutes],
  ['payments',       paymentsRoutes],
  ['nav/zones',      navZonesRoutes],
  ['nav/road-prefs', navRoadPrefsRoutes],
  ['nav/map-match',  navMapMatchRoutes],
  // ── Nuevos ────────────────────────────────────────────────────────────────
  ['sync',           syncRoutes],   // POST /api/sync/test
                                    // POST /api/sync/drivers/:id/location-batch
                                    // POST /api/sync/drivers/:id/battery-alert
  ['voice',          voiceRoutes],  // POST /api/voice/transcribe
  ['support',        supportRoutes], // GET/POST /api/support/tickets
                                     // GET/POST /api/support/tickets/:id/messages
                                     // PATCH    /api/support/tickets/:id/status
  ['push',           pushRoutes],    // POST /api/push/subscribe, DELETE /api/push/unsubscribe
];

export function registerApplicationRoutes(app) {
  for (const [path, router] of routeRegistry) {
    app.use(`/api/${path}`, router);
  }

  for (const [path, router] of routeRegistry) {
    app.use(`/${path}`, router);
  }
}

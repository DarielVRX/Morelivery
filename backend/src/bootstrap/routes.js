import authRoutes from '../modules/auth/routes.js';
import restaurantRoutes from '../modules/restaurants/routes.js';
import orderRoutes from '../modules/orders/routes.js';
import driverRoutes from '../modules/drivers/routes.js';
import adminRoutes from '../modules/admin/routes.js';
import eventRoutes from '../modules/events/routes.js';
import routeModelRoutes from '../modules/routes/routes.js';
import paymentsRoutes from '../modules/payments/routes.js';
import navZonesRoutes from '../modules/nav/zones.js';
import navRoadPrefsRoutes from '../modules/nav/road-prefs.js';
import navMapMatchRoutes from '../modules/nav/map-match.js';

const routeRegistry = [
  ['auth', authRoutes],
  ['restaurants', restaurantRoutes],
  ['orders', orderRoutes],
  ['drivers', driverRoutes],
  ['admin', adminRoutes],
  ['events', eventRoutes],
  ['routes', routeModelRoutes],
  ['payments', paymentsRoutes],
  ['nav/zones', navZonesRoutes],
  ['nav/road-prefs', navRoadPrefsRoutes],
  ['nav/map-match', navMapMatchRoutes],
];

export function registerApplicationRoutes(app) {
  for (const [path, router] of routeRegistry) {
    app.use(`/api/${path}`, router);
  }

  for (const [path, router] of routeRegistry) {
    app.use(`/${path}`, router);
  }
}

// backend/src/modules/admin/routes.js
//
// Index del módulo admin — monta los sub-routers por dominio.
// Cada archivo agrupa rutas relacionadas para mantener el módulo manejable.

import { Router } from 'express';
import exportRoutes    from './export.js';
import analyticsRoutes from './route-groups/analytics.js';
import usersRoutes     from './route-groups/users.js';
import engineRoutes    from './route-groups/engine.js';
import emergencyRoutes from './route-groups/emergency.js';
import platformRoutes  from './route-groups/platform.js';

const router = Router();

// Exportación de datos (CSV/Excel)
router.use('/orders', exportRoutes);

// Consultas, métricas y reportes
router.use('/', analyticsRoutes);

// Gestión de usuarios
router.use('/', usersRoutes);

// Motor de asignación y notificaciones
router.use('/', engineRoutes);

// Acciones de emergencia / operaciones
router.use('/', emergencyRoutes);

// Pausa de plataforma y datos de mapa
router.use('/', platformRoutes);

export default router;

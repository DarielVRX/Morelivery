// backend/modules/events/routes.js
// Server-Sent Events \u2014 el cliente abre una conexi\u00f3n persistente y recibe push sin polling

import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { sseHub } from './hub.js';

const router = Router();

/**
 * GET /api/events
 * El cliente se suscribe y recibe eventos en tiempo real.
 * Compatible con Render (no requiere WebSockets).
 * Formato: text/event-stream est\u00e1ndar.
 */
router.get('/', (req, res, next) => {
  // EventSource en browser no puede enviar headers — aceptar token por query param
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  return authenticate(req, res, next);
}, (req, res) => {
  // Headers SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx/Render: no bufferizar
  res.flushHeaders();

  const userId = req.user.userId;
  const role = req.user.role;

  // Registrar cliente en el hub
  const clientId = sseHub.register(userId, role, res);

  // Ping cada 25s para mantener conexi\u00f3n viva (Render cierra a los 30s sin actividad)
  const ping = setInterval(() => {
    try { res.write(':ping\n\n'); } catch (_) { clearInterval(ping); }
  }, 25000);

  // Limpiar al desconectar
  req.on('close', () => {
    clearInterval(ping);
    sseHub.unregister(clientId);
  });
});

export default router;

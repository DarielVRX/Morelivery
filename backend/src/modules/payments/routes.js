// ── Pagos — rutas placeholder (sin procesador real conectado) ─────────────────
// TODO: conectar Stripe (card) o Conekta (card + SPEI + efectivo) cuando sea necesario.
// Endpoints estructurados para no requerir cambios en el frontend al activarlos.

import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { AppError } from '../../utils/errors.js';

const router = Router();

/* ── GET /payments/methods ── métodos disponibles ── */
router.get('/methods', authenticate, async (_req, res) => {
  return res.json({
    methods: [
      { id: 'cash', label: 'Efectivo al entregar', available: true },
      { id: 'card', label: 'Tarjeta de crédito/débito', available: false, coming_soon: true },
      { id: 'spei', label: 'SPEI / Transferencia', available: false, coming_soon: true },
    ],
  });
});

/* ── POST /payments/intent ── crear intención de pago ── */
// body: { orderId, amount_cents, method: 'card'|'spei' }
router.post('/intent', authenticate, async (_req, res, next) => {
  return next(new AppError(501, 'Pagos en línea no disponibles aún. Usa efectivo al entregar.'));
});

/* ── POST /payments/confirm ── confirmar pago ── */
router.post('/confirm', authenticate, async (_req, res, next) => {
  return next(new AppError(501, 'Pagos en línea no disponibles aún.'));
});

/* ── POST /payments/webhook ── webhook procesador (verificar firma antes de activar) ── */
router.post('/webhook', async (_req, res) => {
  // TODO: verificar HMAC signature + actualizar orders.payment_status
  return res.json({ received: true });
});

export default router;

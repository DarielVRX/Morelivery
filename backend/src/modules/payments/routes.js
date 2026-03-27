import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { AppError } from '../../utils/errors.js';
import { createStripePaymentIntent, getStripePublicConfig } from './stripeProvider.js';
import { query } from '../../config/db.js';

const router = Router();

/* ── GET /payments/methods ── métodos disponibles ── */
router.get('/methods', authenticate, async (_req, res) => {
  const stripe = getStripePublicConfig();
  return res.json({
    methods: [
      { id: 'cash', label: 'Efectivo al entregar', available: true },
      { id: 'card', label: 'Tarjeta de crédito/débito', available: stripe.configured, provider: 'stripe', coming_soon: !stripe.configured },
      { id: 'spei', label: 'SPEI / Transferencia', available: false, coming_soon: true },
    ],
    providers: { stripe },
  });
});

/* ── POST /payments/intent ── crear intención de pago ── */
// body: { orderId, amount_cents, method: 'card'|'spei' }
router.post('/intent', authenticate, async (req, res, next) => {
  try {
    const { orderId, amount_cents: amountCents, method = 'card' } = req.body || {};
    if (method !== 'card') {
      return next(new AppError(400, 'Por ahora solo se soporta method=card (Stripe).'));
    }
    if (!orderId) return next(new AppError(400, 'orderId es requerido'));

    const orderResult = await query(
      `SELECT id, customer_id, total_cents, status
         FROM orders
        WHERE id = $1
        LIMIT 1`,
      [orderId],
    );
    const order = orderResult.rows[0];
    if (!order) return next(new AppError(404, 'Pedido no encontrado'));
    if (order.customer_id !== req.user.userId) {
      return next(new AppError(403, 'No puedes pagar un pedido de otro usuario'));
    }
    if (order.status === 'cancelled' || order.status === 'delivered') {
      return next(new AppError(409, 'No se puede iniciar pago para un pedido cerrado'));
    }

    const normalizedAmount = Number.isInteger(amountCents) ? amountCents : Number(order.total_cents);
    const intent = await createStripePaymentIntent({
      amountCents: normalizedAmount,
      currency: 'mxn',
      metadata: {
        order_id: orderId,
        customer_id: req.user.userId,
      },
    });

    await query(
      `INSERT INTO payment_intents (
         order_id, user_id, provider, provider_intent_id,
         amount_cents, currency, status, client_secret, metadata, updated_at
       ) VALUES ($1,$2,'stripe',$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (provider_intent_id)
       DO UPDATE SET
         amount_cents = EXCLUDED.amount_cents,
         status = EXCLUDED.status,
         client_secret = EXCLUDED.client_secret,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      [
        orderId,
        req.user.userId,
        intent.paymentIntentId,
        normalizedAmount,
        intent.currency,
        intent.status,
        intent.clientSecret,
        JSON.stringify({ method, order_id: orderId, customer_id: req.user.userId }),
      ],
    );

    return res.json({
      ok: true,
      method: 'card',
      provider: 'stripe',
      orderId,
      amount_cents: normalizedAmount,
      ...intent,
    });
  } catch (error) { return next(error); }
});

/* ── POST /payments/confirm ── confirmar pago ── */
router.post('/confirm', authenticate, async (_req, res, next) => {
  return next(new AppError(501, 'Confirmación manual no disponible. Stripe confirma vía webhook.'));
});

/* ── POST /payments/webhook ── webhook procesador (verificar firma antes de activar) ── */
router.post('/webhook', async (_req, res) => {
  // Arquitectura lista para recibir eventos Stripe:
  // - payment_intent.succeeded
  // - payment_intent.payment_failed
  // Pendiente: verificación de firma + persistencia de estado de pago por orden.
  return res.json({ received: true });
});

export default router;

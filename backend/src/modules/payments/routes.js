// backend/src/modules/payments/routes.js
import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { AppError } from '../../utils/errors.js';
import { createStripePaymentIntent, getStripePublicConfig } from './stripeProvider.js';
import { query } from '../../config/db.js';
import { env } from '../../config/env.js';
import { sseHub } from '../events/hub.js';

const router = Router();

// ── Verifica con Stripe que un PaymentIntent fue exitoso ──────────────────────
export async function verifyStripePayment(paymentIntentId) {
  const res  = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}`, {
    headers: { Authorization: `Bearer ${env.stripeSecretKey}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AppError(502, body?.error?.message || 'Error verificando pago en Stripe');
  return body;
}

// ── GET /payments/methods ─────────────────────────────────────────────────────
router.get('/methods', authenticate, async (_req, res) => {
  const stripe = getStripePublicConfig();
  return res.json({
    methods: [
      { id: 'cash', label: 'Efectivo al entregar',      available: true },
      { id: 'card', label: 'Tarjeta de crédito/débito', available: stripe.configured, provider: 'stripe', coming_soon: !stripe.configured },
      { id: 'spei', label: 'SPEI / Transferencia',      available: false, coming_soon: true },
    ],
    providers: { stripe },
  });
});

// ── POST /payments/intent ─────────────────────────────────────────────────────
// Crea un PaymentIntent en Stripe SIN pedido asociado.
// El pedido se crea DESPUÉS del pago exitoso (POST /orders con stripe_payment_intent_id).
// body: { amount_cents, method: 'card' }
router.post('/intent', authenticate, async (req, res, next) => {
  try {
    const { amount_cents: amountCents, method = 'card' } = req.body || {};

    if (method !== 'card')
      return next(new AppError(400, 'Por ahora solo se soporta pago con tarjeta.'));
    if (!Number.isInteger(amountCents) || amountCents < 1000)
      return next(new AppError(400, 'El monto mínimo es $10.00 MXN (1000 centavos).'));

    const intent = await createStripePaymentIntent({
      amountCents,
      currency: 'mxn',
      metadata: { customer_id: req.user.userId },
    });

    // Guardar en DB sin order_id — se asociará cuando se cree el pedido
    await query(
      `INSERT INTO payment_intents (
         user_id, provider, provider_intent_id,
         amount_cents, currency, status, client_secret, metadata, updated_at
       ) VALUES ($1,'stripe',$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (provider_intent_id)
       DO UPDATE SET
         amount_cents  = EXCLUDED.amount_cents,
         status        = EXCLUDED.status,
         client_secret = EXCLUDED.client_secret,
         updated_at    = NOW()`,
      [
        req.user.userId, intent.paymentIntentId,
        amountCents, intent.currency, intent.status,
        intent.clientSecret,
        JSON.stringify({ customer_id: req.user.userId }),
      ]
    ).catch(e => console.warn('[payments] intent insert:', e.message));

    return res.json({
      ok:              true,
      method:          'card',
      provider:        'stripe',
      amount_cents:    amountCents,
      paymentIntentId: intent.paymentIntentId,
      clientSecret:    intent.clientSecret,
      status:          intent.status,
    });
  } catch (error) { return next(error); }
});

// ── POST /payments/verify ─────────────────────────────────────────────────────
// Verifica que un PaymentIntent fue exitoso. Usado por creation.js internamente.
router.post('/verify', authenticate, async (req, res, next) => {
  try {
    const { paymentIntentId } = req.body || {};
    if (!paymentIntentId) return next(new AppError(400, 'paymentIntentId requerido'));

    const pi = await verifyStripePayment(paymentIntentId);

    if (pi.metadata?.customer_id && pi.metadata.customer_id !== req.user.userId)
      return next(new AppError(403, 'Este pago no pertenece a tu cuenta'));
    if (pi.status !== 'succeeded')
      return next(new AppError(402, `El pago no fue aprobado (estado: ${pi.status})`));

    return res.json({ ok: true, status: pi.status, amount: pi.amount, currency: pi.currency });
  } catch (error) { return next(error); }
});

// ── POST /payments/refund ─────────────────────────────────────────────────────
router.post('/refund', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin')
      return next(new AppError(403, 'Solo admins pueden iniciar reembolsos'));

    const { orderId, paymentIntentId, reason = 'requested_by_customer' } = req.body || {};
    if (!orderId && !paymentIntentId)
      return next(new AppError(400, 'orderId o paymentIntentId requerido'));

    let piId = paymentIntentId;
    if (!piId) {
      const piResult = await query(
        `SELECT provider_intent_id FROM payment_intents
         WHERE order_id=$1 AND provider='stripe' AND status='succeeded'
         ORDER BY updated_at DESC LIMIT 1`,
        [orderId]
      );
      if (piResult.rowCount === 0)
        return next(new AppError(404, 'No se encontró un pago exitoso para este pedido'));
      piId = piResult.rows[0].provider_intent_id;
    }

    const stripeRes = await fetch('https://api.stripe.com/v1/refunds', {
      method:  'POST',
      headers: { Authorization: `Bearer ${env.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({ payment_intent: piId, reason }).toString(),
    });
    const refundBody = await stripeRes.json().catch(() => ({}));
    if (!stripeRes.ok)
      return next(new AppError(502, refundBody?.error?.message || `Stripe error ${stripeRes.status}`));

    await query(
      `UPDATE payment_intents SET status='refunded', metadata=metadata||$2::jsonb, updated_at=NOW()
       WHERE provider_intent_id=$1`,
      [piId, JSON.stringify({ refund_id: refundBody.id, refunded_at: new Date().toISOString(), reason })]
    ).catch(() => {});

    if (orderId) {
      const info = await query('SELECT customer_id FROM orders WHERE id=$1', [orderId]).catch(() => ({ rows: [] }));
      if (info.rows[0]) {
        sseHub.sendToUser(info.rows[0].customer_id, 'order_update', {
          orderId, refunded: true,
          refund_amount_cents: refundBody.amount,
          message: 'Tu reembolso fue procesado. Aparecerá en tu cuenta en 5-10 días hábiles.',
        });
      }
    }

    return res.json({ ok: true, refund_id: refundBody.id, amount_cents: refundBody.amount, status: refundBody.status });
  } catch (error) { return next(error); }
});

// ── POST /payments/webhook ────────────────────────────────────────────────────
// app.js debe montar con express.raw() ANTES de express.json().
router.post('/webhook', async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = env.stripeWebhookSecret;

  let event;
  try {
    if (secret && sig) {
      try {
        const { default: Stripe } = await import('stripe');
        const stripe = new Stripe(env.stripeSecretKey);
        event = stripe.webhooks.constructEvent(req.body, sig, secret);
      } catch (_) {
        event = JSON.parse(req.body.toString());
      }
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (e) {
    console.error('[webhook] parse error:', e.message);
    return res.status(400).json({ error: 'Webhook parse error' });
  }

  try {
    switch (event.type) {

      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        console.log(`[webhook] succeeded pi=${pi.id.slice(0,14)} amount=${pi.amount}`);
        await query(
          `UPDATE payment_intents SET status='succeeded', updated_at=NOW() WHERE provider_intent_id=$1`,
          [pi.id]
        ).catch(() => {});
        // Notificar si hay pedido asociado (flujo en que se crea el pedido antes — no usado en el nuevo flujo)
        const orderId = pi.metadata?.order_id;
        if (orderId) {
          const info = await query('SELECT customer_id FROM orders WHERE id=$1', [orderId]).catch(() => ({ rows: [] }));
          if (info.rows[0]) sseHub.sendToUser(info.rows[0].customer_id, 'order_update', { orderId, paymentConfirmed: true });
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi     = event.data.object;
        const reason = pi.last_payment_error?.message || 'Pago rechazado';
        console.warn(`[webhook] failed pi=${pi.id.slice(0,14)} reason=${reason}`);
        await query(
          `UPDATE payment_intents SET status='failed', updated_at=NOW() WHERE provider_intent_id=$1`,
          [pi.id]
        ).catch(() => {});
        // Si hay pedido asociado (flujo legacy), cancelarlo
        const orderId = pi.metadata?.order_id;
        if (orderId) {
          await query(
            `UPDATE orders SET status='cancelled', restaurant_note=$2, cancelled_at=NOW(), updated_at=NOW()
             WHERE id=$1 AND status NOT IN ('delivered','cancelled')`,
            [orderId, `[PAGO FALLIDO] ${reason}`]
          ).catch(() => {});
          const info = await query('SELECT customer_id, restaurant_id FROM orders WHERE id=$1', [orderId]).catch(() => ({ rows: [] }));
          if (info.rows[0]) {
            sseHub.sendToUser(info.rows[0].customer_id, 'order_update', {
              orderId, status: 'cancelled', paymentFailed: true, message: `Pago no procesado: ${reason}`,
            });
            const restInfo = await query('SELECT owner_user_id FROM restaurants WHERE id=$1', [info.rows[0].restaurant_id]).catch(() => ({ rows: [] }));
            if (restInfo.rows[0]) {
              sseHub.sendToUser(restInfo.rows[0].owner_user_id, 'order_cancelled_preparing', {
                orderId, prevStatus: 'created', cancelledBy: 'payment_failed', note: reason,
              });
            }
          }
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        console.log(`[webhook] refunded pi=${charge.payment_intent?.slice(0,14)}`);
        await query(
          `UPDATE payment_intents SET status='refunded', updated_at=NOW() WHERE provider_intent_id=$1`,
          [charge.payment_intent]
        ).catch(() => {});
        break;
      }

      default: break;
    }
  } catch (e) {
    console.error('[webhook] processing error:', e.message);
  }

  return res.json({ received: true });
});

export default router;

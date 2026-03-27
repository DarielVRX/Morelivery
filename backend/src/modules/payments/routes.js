// backend/src/modules/payments/routes.js
import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { AppError } from '../../utils/errors.js';
import { query } from '../../config/db.js';
import { env } from '../../config/env.js';
import { sseHub } from '../events/hub.js';

const router = Router();
const MP_API = 'https://api.mercadopago.com';

// ── Helper: llamada autenticada a MP ─────────────────────────────────────────
async function mpFetch(path, options = {}) {
  const res = await fetch(`${MP_API}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${env.mpAccessToken}`,
      'Content-Type':  'application/json',
      'X-Idempotency-Key': options.idempotencyKey || `${Date.now()}-${Math.random()}`,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error || `MP error ${res.status}`;
    throw new AppError(res.status >= 500 ? 502 : 400, msg);
  }
  return data;
}

// ── Verificar pago MP — exportado para uso en creation.js ────────────────────
export async function verifyMpPayment(paymentId) {
  const data = await mpFetch(`/v1/payments/${paymentId}`);
  return data; // { status, status_detail, transaction_amount, ... }
}

// ── Verificar firma de webhook MP ────────────────────────────────────────────
// MP envía header x-signature: ts=<timestamp>,v1=<hmac>
// El mensaje a firmar es: id:<notif_id>;request-id:<request_id>;ts:<ts>;
async function verifyMpSignature(req) {
  const secret = env.mpWebhookSecret;
  if (!secret) return true; // Sin secret configurado, saltar verificación

  const xSignature  = req.headers['x-signature'] || '';
  const xRequestId  = req.headers['x-request-id'] || '';
  const notifId     = req.query?.['data.id'] || req.body?.data?.id || '';

  // Parsear ts y v1 del header
  const parts = {};
  xSignature.split(',').forEach(part => {
    const [k, v] = part.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  });

  if (!parts.ts || !parts.v1) return false;

  // Construir el mensaje a firmar
  const message = `id:${notifId};request-id:${xRequestId};ts:${parts.ts};`;

  // Calcular HMAC-SHA256
  const { createHmac } = await import('crypto');
  const hash = createHmac('sha256', secret).update(message).digest('hex');

  if (hash !== parts.v1) {
    console.warn(`[webhook:mp] firma inválida — esperado=${hash.slice(0,12)} recibido=${parts.v1.slice(0,12)}`);
    return false;
  }
  return true;
}

// ── GET /payments/methods ─────────────────────────────────────────────────────
router.get('/methods', authenticate, async (_req, res) => {
  const mpConfigured = Boolean(env.mpAccessToken);
  return res.json({
    methods: [
      { id: 'cash', label: 'Efectivo al entregar', available: true },
      { id: 'card', label: 'Tarjeta / OXXO / Transferencia', available: mpConfigured,
        provider: 'mercadopago', coming_soon: !mpConfigured },
    ],
    providers: { mercadopago: { configured: mpConfigured } },
  });
});

// ── POST /payments/preference ─────────────────────────────────────────────────
// Crea una preferencia de pago en MP sin pedido asociado aún.
// Devuelve init_point (URL de pago) y preference_id.
// body: { amount_cents, description?, back_urls? }
router.post('/preference', authenticate, async (req, res, next) => {
  try {
    const { amount_cents: amountCents, description = 'Pedido Morelivery' } = req.body || {};

    if (!env.mpAccessToken)
      return next(new AppError(503, 'Pago con tarjeta no configurado en el servidor.'));
    if (!Number.isInteger(amountCents) || amountCents < 1000)
      return next(new AppError(400, 'El monto mínimo es $10.00 MXN.'));

    const amountMXN = amountCents / 100;
    const frontendUrl = env.frontendUrl || 'https://morelivery.vercel.app';

    const preference = await mpFetch('/checkout/preferences', {
      method: 'POST',
      body: {
        items: [{
          title:      description,
          quantity:   1,
          unit_price: amountMXN,
          currency_id: 'MXN',
        }],
        payer: { email: 'cliente@morelivery.app' }, // placeholder — MP lo actualiza al pagar
        back_urls: {
          success: `${frontendUrl}/customer/pagos/resultado?status=approved`,
          failure: `${frontendUrl}/customer/pagos/resultado?status=rejected`,
          pending: `${frontendUrl}/customer/pagos/resultado?status=pending`,
        },
        auto_return:          'approved',
        statement_descriptor: 'MORELIVERY',
        metadata: {
          customer_id: req.user.userId,
          amount_cents: amountCents,
        },
        notification_url: `${env.backendUrl || 'https://morelivery.onrender.com'}/api/payments/webhook`,
      },
      idempotencyKey: `pref-${req.user.userId}-${Date.now()}`,
    });

    // Guardar en DB
    await query(
      `INSERT INTO payment_intents (
         user_id, provider, provider_intent_id,
         amount_cents, currency, status, metadata, updated_at
       ) VALUES ($1,'mercadopago',$2,$3,'MXN','pending',$4,NOW())
       ON CONFLICT (provider_intent_id) DO UPDATE SET
         amount_cents = EXCLUDED.amount_cents,
         status       = EXCLUDED.status,
         updated_at   = NOW()`,
      [
        req.user.userId,
        preference.id,
        amountCents,
        JSON.stringify({ customer_id: req.user.userId, amount_cents: amountCents }),
      ]
    ).catch(e => console.warn('[payments] preference insert:', e.message));

    return res.json({
      ok:            true,
      provider:      'mercadopago',
      preferenceId:  preference.id,
      initPoint:     preference.init_point,        // URL de pago escritorio
      mobileInitPoint: preference.sandbox_init_point || preference.init_point, // móvil
      amount_cents:  amountCents,
    });
  } catch (error) { return next(error); }
});

// ── POST /payments/process-card ──────────────────────────────────────────────
// Recibe los datos del Card Brick y crea el pago en MP.
// El Brick envía: token, payment_method_id, installments, issuer_id, payer, etc.
router.post('/process-card', authenticate, async (req, res, next) => {
  try {
    if (!env.mpAccessToken)
      return next(new AppError(503, 'Pago con tarjeta no configurado.'));

    const cardData = req.body || {};
    if (!cardData.token)
      return next(new AppError(400, 'Token de tarjeta requerido'));

    // Obtener el amount desde el payment_intent guardado o del body
    const amountCents = cardData.transaction_amount
      ? Math.round(cardData.transaction_amount * 100)
      : null;
    if (!amountCents || amountCents < 1000)
      return next(new AppError(400, 'Monto inválido'));

    const payment = await mpFetch('/v1/payments', {
      method: 'POST',
      body: {
        transaction_amount: amountCents / 100,
        token:              cardData.token,
        payment_method_id:  cardData.payment_method_id,
        installments:       cardData.installments || 1,
        issuer_id:          cardData.issuer_id,
        payer: {
          email:          cardData.payer?.email || 'cliente@morelivery.app',
          identification: cardData.payer?.identification,
        },
        metadata: { customer_id: req.user.userId },
        statement_descriptor: 'MORELIVERY',
      },
      idempotencyKey: `card-${req.user.userId}-${Date.now()}`,
    });

    // Guardar intent en DB
    await query(
      `INSERT INTO payment_intents (
         user_id, provider, provider_intent_id,
         amount_cents, currency, status, metadata, updated_at
       ) VALUES ($1,'mercadopago',$2,$3,'MXN',$4,$5,NOW())
       ON CONFLICT (provider_intent_id) DO UPDATE SET
         status=EXCLUDED.status, updated_at=NOW()`,
      [
        req.user.userId, String(payment.id),
        amountCents, payment.status,
        JSON.stringify({ customer_id: req.user.userId, amount_cents: amountCents }),
      ]
    ).catch(e => console.warn('[process-card] insert:', e.message));

    return res.json({
      ok:            true,
      payment_id:    payment.id,
      status:        payment.status,
      status_detail: payment.status_detail,
    });
  } catch (error) { return next(error); }
});

// ── POST /payments/verify ─────────────────────────────────────────────────────
// Verifica que un pago de MP fue aprobado.
// Llamado por creation.js antes de crear el pedido.
router.post('/verify', authenticate, async (req, res, next) => {
  try {
    const { paymentId } = req.body || {};
    if (!paymentId) return next(new AppError(400, 'paymentId requerido'));

    const payment = await verifyMpPayment(paymentId);

    if (payment.metadata?.customer_id && payment.metadata.customer_id !== req.user.userId)
      return next(new AppError(403, 'Este pago no pertenece a tu cuenta'));

    if (payment.status !== 'approved')
      return next(new AppError(402, `El pago no fue aprobado (estado: ${payment.status})`));

    return res.json({
      ok:      true,
      status:  payment.status,
      amount:  payment.transaction_amount,
      method:  payment.payment_type_id,
    });
  } catch (error) { return next(error); }
});

// ── POST /payments/refund ─────────────────────────────────────────────────────
// Reembolso manual — solo admin.
router.post('/refund', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin')
      return next(new AppError(403, 'Solo admins pueden iniciar reembolsos'));

    const { orderId, paymentId, reason = 'Cancelación por soporte' } = req.body || {};
    if (!orderId && !paymentId)
      return next(new AppError(400, 'orderId o paymentId requerido'));

    let mpPaymentId = paymentId;
    if (!mpPaymentId) {
      const piResult = await query(
        `SELECT provider_intent_id FROM payment_intents
         WHERE order_id=$1 AND provider='mercadopago' AND status='approved'
         ORDER BY updated_at DESC LIMIT 1`,
        [orderId]
      );
      if (piResult.rowCount === 0)
        return next(new AppError(404, 'No se encontró un pago aprobado para este pedido'));
      mpPaymentId = piResult.rows[0].provider_intent_id;
    }

    // MP: POST /v1/payments/:id/refunds
    const refund = await mpFetch(`/v1/payments/${mpPaymentId}/refunds`, {
      method: 'POST',
      body: { metadata: { reason } },
      idempotencyKey: `refund-${mpPaymentId}-${Date.now()}`,
    });

    await query(
      `UPDATE payment_intents SET status='refunded',
       metadata=metadata||$2::jsonb, updated_at=NOW()
       WHERE provider_intent_id=$1`,
      [mpPaymentId, JSON.stringify({ refund_id: refund.id, refunded_at: new Date().toISOString(), reason })]
    ).catch(() => {});

    // Notificar al cliente
    if (orderId) {
      const info = await query('SELECT customer_id, total_cents FROM orders WHERE id=$1', [orderId])
        .catch(() => ({ rows: [] }));
      if (info.rows[0]) {
        sseHub.sendToUser(info.rows[0].customer_id, 'order_update', {
          orderId, refunded: true,
          message: 'Tu reembolso fue procesado. Aparecerá en tu cuenta en 5-10 días hábiles.',
        });
      }
    }

    return res.json({ ok: true, refund_id: refund.id, status: refund.status });
  } catch (error) { return next(error); }
});

// ── POST /payments/webhook ────────────────────────────────────────────────────
// MP envía notificaciones aquí.
// MP usa POST con body { type, data: { id } } para pagos.
// MP valida el endpoint con GET al guardar la URL
router.get('/webhook', (_req, res) => res.json({ ok: true }));

router.post('/webhook', async (req, res) => {
  try {
    // Verificar firma si hay secret configurado
    const valid = await verifyMpSignature(req);
    if (!valid) {
      console.warn('[webhook:mp] firma inválida — request ignorado');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const { type, data } = req.body || {};
    if (!type) return res.json({ ok: true });

    console.log(`[webhook:mp] type=${type} id=${data?.id}`);

    if (type === 'payment') {
      const paymentId = data?.id;
      if (!paymentId) return res.json({ ok: true });

      // Obtener detalles del pago
      const payment = await mpFetch(`/v1/payments/${paymentId}`).catch(() => null);
      if (!payment) return res.json({ ok: true });

      console.log(`[webhook:mp] payment status=${payment.status} amount=${payment.transaction_amount}`);

      // Actualizar estado en DB
      await query(
        `UPDATE payment_intents SET status=$2, updated_at=NOW()
         WHERE provider_intent_id=$1`,
        [String(paymentId), payment.status]
      ).catch(() => {});

      const orderId = payment.metadata?.order_id || payment.external_reference;

      if (payment.status === 'approved' && orderId) {
        // Notificar al cliente
        const info = await query('SELECT customer_id FROM orders WHERE id=$1', [orderId])
          .catch(() => ({ rows: [] }));
        if (info.rows[0]) {
          sseHub.sendToUser(info.rows[0].customer_id, 'order_update', {
            orderId, paymentConfirmed: true,
          });
        }
      }

      if (payment.status === 'rejected' || payment.status === 'cancelled') {
        if (orderId) {
          await query(
            `UPDATE orders SET status='cancelled', restaurant_note=$2,
             cancelled_at=NOW(), updated_at=NOW()
             WHERE id=$1 AND status NOT IN ('delivered','cancelled')`,
            [orderId, `[PAGO RECHAZADO MP] ${payment.status_detail || ''}`]
          ).catch(() => {});

          const info = await query(
            'SELECT customer_id, restaurant_id FROM orders WHERE id=$1', [orderId]
          ).catch(() => ({ rows: [] }));

          if (info.rows[0]) {
            sseHub.sendToUser(info.rows[0].customer_id, 'order_update', {
              orderId, status: 'cancelled', paymentFailed: true,
              message: `Pago rechazado: ${payment.status_detail || 'intenta de nuevo'}.`,
            });
            const restInfo = await query(
              'SELECT owner_user_id FROM restaurants WHERE id=$1', [info.rows[0].restaurant_id]
            ).catch(() => ({ rows: [] }));
            if (restInfo.rows[0]) {
              sseHub.sendToUser(restInfo.rows[0].owner_user_id, 'order_cancelled_preparing', {
                orderId, prevStatus: 'created', cancelledBy: 'payment_failed',
              });
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('[webhook:mp] error:', e.message);
  }

  return res.json({ ok: true });
});

export default router;

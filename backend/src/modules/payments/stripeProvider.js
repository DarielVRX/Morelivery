import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

function isStripeConfigured() {
  return Boolean(env.stripeSecretKey && env.stripePublishableKey);
}

function encodeForm(data) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null) params.append(key, String(value));
  }
  return params.toString();
}

export async function createStripePaymentIntent({ amountCents, currency = 'mxn', metadata = {} }) {
  if (!isStripeConfigured()) {
    throw new AppError(503, 'Stripe no configurado en servidor (faltan claves STRIPE_*).');
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new AppError(400, 'Monto inválido para payment intent.');
  }

  const payload = {
    amount:   amountCents,
    currency,
    'automatic_payment_methods[enabled]': 'true',  // formato form-encoded correcto
  };

  for (const [k, v] of Object.entries(metadata || {})) {
    payload[`metadata[${k}]`] = v;
  }

  const res = await fetch(`${STRIPE_API_BASE}/payment_intents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encodeForm(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || `Stripe error ${res.status}`;
    throw new AppError(502, msg);
  }

  return {
    provider: 'stripe',
    paymentIntentId: body.id,
    clientSecret: body.client_secret,
    status: body.status,
    amount: body.amount,
    currency: body.currency,
  };
}

export function getStripePublicConfig() {
  return {
    configured: isStripeConfigured(),
    publishableKey: env.stripePublishableKey || null,
  };
}

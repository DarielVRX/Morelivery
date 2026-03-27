# Stripe (tarjeta) — configuración inicial

## 1) Variables de entorno del backend

Configura en tu entorno de backend:

- `STRIPE_SECRET_KEY=sk_test_...`
- `STRIPE_PUBLISHABLE_KEY=pk_test_...`
- `STRIPE_WEBHOOK_SECRET=whsec_...` (cuando actives webhook real)

También conserva:

- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` para push web.

## 2) Migración de base de datos

Ejecuta:

```sql
\i database/migration_stripe_payments.sql
```

Esto crea:

- `payment_intents` para rastrear intents por orden.
- `payment_webhook_events` para idempotencia y auditoría de webhooks.

## 3) Flujo backend habilitado

Con `STRIPE_*` configuradas:

1. `GET /api/payments/methods` marcará `card.available=true`.
2. `POST /api/payments/intent` crea un PaymentIntent en Stripe y persiste la referencia local.
3. `POST /api/payments/webhook` queda como endpoint listo para completar verificación de firma y reconciliación.

## 4) Próximos pasos para cerrar E2E

1. Integrar Stripe.js en frontend (`@stripe/stripe-js` + Elements/PaymentElement).
2. Consumir `clientSecret` de `/api/payments/intent`.
3. Confirmar pago del lado cliente con Stripe.js.
4. Activar webhook con firma y actualizar estado de orden (`paid`, `failed`, etc).
5. Bloquear despacho si método `card` y pago no confirmado.

// STRIPE DESHABILITADO — reemplazado por Mercado Pago
// Para reactivar: restaurar desde git y configurar variables STRIPE_* en Render

export async function createStripePaymentIntent() {
  throw new Error('Stripe deshabilitado. Usa Mercado Pago.');
}

export function getStripePublicConfig() {
  return { configured: false, publishableKey: null };
}

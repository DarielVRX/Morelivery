export function isCashPayment(order) {
  return (order?.payment_method || 'cash') === 'cash';
}

export function getDriverTipCents(order, { includeDeliveredTip = false } = {}) {
  return (order?.tip_cents || 0) + (includeDeliveredTip ? (order?.delivered_tip_cents || 0) : 0);
}

export function getDriverEarningCents(order, { includeDeliveredTip = false } = {}) {
  const serviceFeeCents = order?.service_fee_cents || 0;
  const deliveryFeeCents = order?.delivery_fee_cents || 0;
  const tipCents = getDriverTipCents(order, { includeDeliveredTip });

  return deliveryFeeCents + Math.round(serviceFeeCents * 0.5) + tipCents;
}

export function getOrderGrandTotalCents(order, { includeDeliveredTip = false } = {}) {
  return (order?.total_cents || 0)
    + (order?.service_fee_cents || 0)
    + (order?.delivery_fee_cents || 0)
    + getDriverTipCents(order, { includeDeliveredTip });
}

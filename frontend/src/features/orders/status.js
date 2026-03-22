export const TERMINAL_ORDER_STATUSES = ['delivered', 'cancelled'];

export function isTerminalOrderStatus(status) {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

export function splitOrdersByTerminalStatus(orders = []) {
  return {
    active: orders.filter((order) => !isTerminalOrderStatus(order.status)),
    past: orders.filter((order) => isTerminalOrderStatus(order.status)),
  };
}

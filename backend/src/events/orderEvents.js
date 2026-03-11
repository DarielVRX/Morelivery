// orderEvents — stub vacío. Las notificaciones en tiempo real
// se manejan íntegramente a través de SSE (modules/events/hub.js).
// Mantenemos el módulo para no romper imports existentes.
class OrderEvents {
  emitOrderUpdate(_orderId, _status) {}
}

export const orderEvents = new OrderEvents();

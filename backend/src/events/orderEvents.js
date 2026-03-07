class OrderEvents {
  io = null;

  setSocket(io) {
    this.io = io;
  }

  emitOrderUpdate(orderId, status) {
    if (!this.io) return;
    // En lugar de new Date(), podrías enviar un flag de actualización
    this.io.emit('order:update', { orderId, status });
  }
}

export const orderEvents = new OrderEvents();

class OrderEvents {
  io = null;

  setSocket(io) {
    this.io = io;
  }

  emitOrderUpdate(orderId, status) {
    if (!this.io) return;
    this.io.emit('order:update', { orderId, status, updatedAt: new Date().toISOString() });
  }
}

export const orderEvents = new OrderEvents();

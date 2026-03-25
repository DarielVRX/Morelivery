// backend/modules/events/hub.js
let _id = 0;

class SseHub {
  constructor() {
    this._clients = new Map();
    this._heartbeat = setInterval(() => {
      for (const [clientId, c] of this._clients) {
        try {
          c.res.write(': ping\n\n');
        } catch (_) {
          this._clients.delete(clientId);
        }
      }
    }, 25_000);
  }

  destroy() {
    clearInterval(this._heartbeat);
    this._clients.clear();
  }

  register(userId, role, res) {
    const clientId = ++_id;
    this._clients.set(clientId, { userId, role, res });
    this._send(res, 'connected', { clientId });
    return clientId;
  }

  unregister(clientId) { this._clients.delete(clientId); }

  sendToUser(userId, event, data) {
    for (const c of this._clients.values())
      if (c.userId === userId) this._send(c.res, event, data);
  }

  sendToRole(role, event, data) {
    for (const c of this._clients.values())
      if (c.role === role) this._send(c.res, event, data);
  }

  sendToUsers(userIds, event, data) {
    const set = new Set(userIds);
    for (const c of this._clients.values())
      if (set.has(c.userId)) this._send(c.res, event, data);
  }

  notifyNewOffer(driverId, offerId, orderData) {
    const payload = { type: 'new_offer', offerId, ...orderData };
    this.sendToUser(driverId, 'new_offer', payload);
    this.sendToRole('admin', 'offer_assigned', {
      driverId,
      driverName: orderData.driverName,
      orderId: orderData.orderId,
      restaurantName: orderData.restaurantName,
      totalCents: orderData.totalCents,
      ts: new Date().toISOString(),
    });
  }

  _send(res, event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
    catch (_) {}
  }

  get size() { return this._clients.size; }

  // Nuevo: obtener estadísticas para admin
  getStats() {
    const byRole = new Map();
    for (const c of this._clients.values()) {
      byRole.set(c.role, (byRole.get(c.role) || 0) + 1);
    }
    return {
      connected: this._clients.size,
      byRole: Object.fromEntries(byRole),
    };
  }
}

export const sseHub = new SseHub();

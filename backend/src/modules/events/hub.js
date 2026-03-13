// backend/modules/events/hub.js
let _id = 0;

class SseHub {
  constructor() {
    // Map<clientId, { userId, role, res }>
    this._clients = new Map();

    // Heartbeat cada 25 s — reinicia el timer de idle en Render (timeout: 55 s) y en
    // proxies HTTP intermedios. Un comentario SSE (": ping\n\n") es ignorado por el
    // cliente pero mantiene el socket TCP vivo. Si write() lanza, el cliente ya se fue
    // (red caída, cambio de WiFi en el móvil) → se limpia del mapa inmediatamente.
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

  /** Llamar en shutdown graceful para no dejar el interval colgado en tests/dev. */
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

  /** Notificar a admins y al driver específico cuando hay nueva oferta */
  notifyNewOffer(driverId, offerId, orderData) {
    const payload = { type: 'new_offer', offerId, ...orderData };
    // Al driver: evento especial para mostrar notificación sin esperar poll
    this.sendToUser(driverId, 'new_offer', payload);
    // A admins: actualización en tiempo real del panel
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
}

export const sseHub = new SseHub();

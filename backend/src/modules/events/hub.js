// backend/modules/events/hub.js
// Hub central de SSE \u2014 mantiene la lista de conexiones activas y emite eventos dirigidos

let _id = 0;

class SseHub {
  constructor() {
    // Map<clientId, { userId, role, res }>
    this._clients = new Map();
  }

  register(userId, role, res) {
    const clientId = ++_id;
    this._clients.set(clientId, { userId, role, res });
    // Confirmar conexi\u00f3n al cliente
    this._send(res, 'connected', { clientId });
    return clientId;
  }

  unregister(clientId) {
    this._clients.delete(clientId);
  }

  /** Enviar a todos los clientes de un usuario espec\u00edfico */
  sendToUser(userId, event, data) {
    for (const client of this._clients.values()) {
      if (client.userId === userId) {
        this._send(client.res, event, data);
      }
    }
  }

  /** Enviar a todos los clientes de un rol */
  sendToRole(role, event, data) {
    for (const client of this._clients.values()) {
      if (client.role === role) {
        this._send(client.res, event, data);
      }
    }
  }

  /** Enviar a una lista de userIds (ej: todos los drivers que tienen el pedido en oferta) */
  sendToUsers(userIds, event, data) {
    const set = new Set(userIds);
    for (const client of this._clients.values()) {
      if (set.has(client.userId)) {
        this._send(client.res, event, data);
      }
    }
  }

  _send(res, event, data) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (_) {
      // Cliente ya desconectado \u2014 ignorar
    }
  }

  get size() { return this._clients.size; }
}

// Singleton compartido por toda la app
export const sseHub = new SseHub();

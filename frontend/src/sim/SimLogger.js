// frontend/src/sim/SimLogger.js
// Dos arrays separados con máximo 500 entradas (FIFO).
// Logs de estado de pedidos y decisiones del engine.

class SimLogger {
  constructor() {
    this._orderLogs = [];      // logs de estado de pedidos
    this._engineLogs = [];     // logs de decisiones del engine
    this._maxSize = 500;
    this._listeners = new Set(); // para UI reactiva
  }

  /**
   * Registra un log de estado de pedido.
   * @param {string} type - 'created' | 'assigned' | 'status_change' | 'delivered' | 'cancelled' | 'released'
   * @param {Object} data - datos adicionales
   */
  logOrder(type, data) {
    const entry = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type,
      data: { ...data },
      timestamp: Date.now(),
      simTime: data.simTime || 0,
    };

    this._orderLogs.unshift(entry); // más reciente primero
    
    // Mantener tamaño máximo
    while (this._orderLogs.length > this._maxSize) {
      this._orderLogs.pop();
    }
    
    this._notifyListeners();
    return entry;
  }

  /**
   * Registra un log de decisión del engine.
   * @param {string} type - 'assign' | 'scoring' | 'reroute' | 'sla' | 'kitchen' | 'movement' | 'offer_sent' | 'offer_accepted' | 'offer_rejected' | 'offer_timeout'
   * @param {Object} data - datos adicionales
   */
  logEngine(type, data) {
    const entry = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type,
      data: { ...data },
      timestamp: Date.now(),
      simTime: data.simTime || 0,
    };

    this._engineLogs.unshift(entry); // más reciente primero
    
    // Mantener tamaño máximo
    while (this._engineLogs.length > this._maxSize) {
      this._engineLogs.pop();
    }
    
    this._notifyListeners();
    return entry;
  }

  /**
   * Obtiene logs de pedidos con filtros opcionales.
   * @param {Object} filter - { orderId, type, limit }
   * @returns {Array}
   */
  getOrderLogs(filter = {}) {
    let logs = [...this._orderLogs];
    
    if (filter.orderId) {
      logs = logs.filter(log => log.data.orderId === filter.orderId);
    }
    
    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      logs = logs.filter(log => types.includes(log.type));
    }
    
    if (filter.limit && filter.limit > 0) {
      logs = logs.slice(0, filter.limit);
    }
    
    return logs;
  }

  /**
   * Obtiene logs del engine con filtros opcionales.
   * @param {Object} filter - { type, driverId, orderId, limit }
   * @returns {Array}
   */
  getEngineLogs(filter = {}) {
    let logs = [...this._engineLogs];
    
    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      logs = logs.filter(log => types.includes(log.type));
    }
    
    if (filter.driverId) {
      logs = logs.filter(log => log.data.driverId === filter.driverId);
    }
    
    if (filter.orderId) {
      logs = logs.filter(log => log.data.orderId === filter.orderId);
    }
    
    if (filter.limit && filter.limit > 0) {
      logs = logs.slice(0, filter.limit);
    }
    
    return logs;
  }

  /**
   * Limpia todos los logs.
   */
  clear() {
    this._orderLogs = [];
    this._engineLogs = [];
    this._notifyListeners();
  }

  /**
   * Limpia solo logs de pedidos.
   */
  clearOrderLogs() {
    this._orderLogs = [];
    this._notifyListeners();
  }

  /**
   * Limpia solo logs del engine.
   */
  clearEngineLogs() {
    this._engineLogs = [];
    this._notifyListeners();
  }

  /**
   * Registra un listener para cambios en los logs.
   * @param {Function} callback
   * @returns {Function} unsubscribe
   */
  subscribe(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  _notifyListeners() {
    this._listeners.forEach(cb => {
      try {
        cb();
      } catch (e) {
        console.warn('[SimLogger] Listener error:', e);
      }
    });
  }

  /**
   * Exporta todos los logs a JSON.
   * @returns {Object}
   */
  export() {
    return {
      orderLogs: this._orderLogs,
      engineLogs: this._engineLogs,
      exportedAt: Date.now(),
    };
  }

  /**
   * Importa logs desde JSON (merge, respetando maxSize).
   * @param {Object} data
   */
  import(data) {
    if (data?.orderLogs && Array.isArray(data.orderLogs)) {
      this._orderLogs = [...data.orderLogs, ...this._orderLogs].slice(0, this._maxSize);
    }
    if (data?.engineLogs && Array.isArray(data.engineLogs)) {
      this._engineLogs = [...data.engineLogs, ...this._engineLogs].slice(0, this._maxSize);
    }
    this._notifyListeners();
  }

  /**
   * Estadísticas de logs.
   * @returns {Object}
   */
  getStats() {
    const orderTypes = {};
    const engineTypes = {};
    
    for (const log of this._orderLogs) {
      orderTypes[log.type] = (orderTypes[log.type] || 0) + 1;
    }
    
    for (const log of this._engineLogs) {
      engineTypes[log.type] = (engineTypes[log.type] || 0) + 1;
    }
    
    return {
      orderCount: this._orderLogs.length,
      engineCount: this._engineLogs.length,
      orderTypes,
      engineTypes,
      maxSize: this._maxSize,
    };
  }
}

// Singleton export
let instance = null;

export function getSimLogger() {
  if (!instance) {
    instance = new SimLogger();
  }
  return instance;
}

export default SimLogger;
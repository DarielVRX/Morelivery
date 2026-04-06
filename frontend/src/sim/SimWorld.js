// frontend/src/sim/SimWorld.js
// Estado central en memoria del simulador.
// Sin imports de Node, sin DB, sin fetch a /api/.
// EventBus reemplaza SSE de producción.

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const idx = this.listeners.get(event).indexOf(callback);
    if (idx !== -1) this.listeners.get(event).splice(idx, 1);
  }

  emit(event, data) {
    if (!this.listeners.has(event)) return;
    this.listeners.get(event).forEach(cb => {
      try { cb(data); } catch (e) { console.warn(`[EventBus] ${event}:`, e); }
    });
  }

  clear() {
    this.listeners.clear();
  }
}

class SimWorld {
  constructor() {
    this.eventBus = new EventBus();

    // Entidades
    this.drivers = new Map();      // id -> DriverState
    this.restaurants = new Map();  // id -> RestaurantState
    this.customers = new Map();    // id -> CustomerState
    this.orders = new Map();       // id -> OrderState

    // Contadores secuenciales
    this._driverSeq = 1;
    this._restaurantSeq = 1;
    this._customerSeq = 1;
    this._orderSeq = 1;

    // Estado de simulación
    this._running = false;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers de IDs
  // ──────────────────────────────────────────────────────────────────────────

  _nextDriverId() {
    const id = `D-${String(this._driverSeq).padStart(2, '0')}`;
    this._driverSeq++;
    return id;
  }

  _nextRestaurantId() {
    const id = `R-${String(this._restaurantSeq).padStart(2, '0')}`;
    this._restaurantSeq++;
    return id;
  }

  _nextCustomerId() {
    const id = `C-${String(this._customerSeq).padStart(2, '0')}`;
    this._customerSeq++;
    return id;
  }

  _nextOrderId() {
    const id = `ORD-${String(this._orderSeq).padStart(3, '0')}`;
    this._orderSeq++;
    return id;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Driver CRUD
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * @param {Object} params
   * @param {number} params.lat
   * @param {number} params.lng
   * @param {string} params.vehicleType - 'bike' | 'motorcycle' | 'car'
   * @param {number} params.bagCapacityLiters
   * @param {string} params.name - opcional
   * @returns {string} driverId
   */
  addDriver({ lat, lng, vehicleType = 'car', bagCapacityLiters = 60, name = null }) {
    const id = this._nextDriverId();
    const driver = {
      id,
      name: name || `Conductor ${id}`,
      status: 'is_available',  // 'is_available' | 'is_offline'
      is_available: true,
      vehicle_type: vehicleType,
      bag_capacity_liters: bagCapacityLiters,
      activeOrders: [],        // array de orderIds
      last_lat: lat,
      last_lng: lng,
      // Preferencias de ruta
      impassableWays: [],      // [{ way_id, name, coords, estimated_duration }]
      routePreferences: [],    // [{ way_id, name, coords, preference }]
      // Para MovementEngine
      _activeMovement: null,   // { geometry, currentIndex, progress, speedMs, onComplete }
      _currentOrderId: null,
    };
    this.drivers.set(id, driver);
    this.eventBus.emit('driver_added', { driverId: id, driver });
    return id;
  }

  /**
   * @param {string} driverId
   * @param {boolean} isAvailable
   */
  setDriverAvailability(driverId, isAvailable) {
    const driver = this.drivers.get(driverId);
    if (!driver) return;
    driver.is_available = isAvailable;
    driver.status = isAvailable ? 'is_available' : 'is_offline';
    this.eventBus.emit('driver_availability_changed', { driverId, isAvailable });
  }

  /**
   * @param {string} driverId
   * @param {number} lat
   * @param {number} lng
   */
  updateDriverPosition(driverId, lat, lng) {
    const driver = this.drivers.get(driverId);
    if (!driver) return;
    driver.last_lat = lat;
    driver.last_lng = lng;
    this.eventBus.emit('driver_location', {
      driverId,
      lat,
      lng,
      orderId: driver._currentOrderId,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Restaurant CRUD
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * @param {Object} params
   * @param {number} params.lat
   * @param {number} params.lng
   * @param {string} params.name
   * @param {number} params.prepTimeMins - minutos de preparación estimados
   * @returns {string} restaurantId
   */
  addRestaurant({ lat, lng, name, prepTimeMins = 15 }) {
    const id = this._nextRestaurantId();
    const restaurant = {
      id,
      name: name || `Restaurante ${id}`,
      lat,
      lng,
      prep_time_estimate_s: prepTimeMins * 60,
      is_open: true,
      activeOrders: [],
    };
    this.restaurants.set(id, restaurant);
    this.eventBus.emit('restaurant_added', { restaurantId: id, restaurant });
    return id;
  }

  /**
   * @param {string} restaurantId
   * @param {boolean} isOpen
   */
  setRestaurantOpen(restaurantId, isOpen) {
    const restaurant = this.restaurants.get(restaurantId);
    if (!restaurant) return;
    restaurant.is_open = isOpen;
    this.eventBus.emit('restaurant_open_changed', { restaurantId, isOpen });
  }

  /**
   * @param {string} restaurantId
   * @param {number} prepTimeSecs
   */
  setRestaurantPrepTime(restaurantId, prepTimeSecs) {
    const restaurant = this.restaurants.get(restaurantId);
    if (!restaurant) return;
    restaurant.prep_time_estimate_s = prepTimeSecs;
    this.eventBus.emit('restaurant_prep_changed', { restaurantId, prepTimeSecs });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Customer CRUD
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * @param {Object} params
   * @param {number} params.lat
   * @param {number} params.lng
   * @param {string} params.name
   * @returns {string} customerId
   */
  addCustomer({ lat, lng, name }) {
    const id = this._nextCustomerId();
    const customer = {
      id,
      name: name || `Cliente ${id}`,
      lat,
      lng,
      activeOrderId: null,
    };
    this.customers.set(id, customer);
    this.eventBus.emit('customer_added', { customerId: id, customer });
    return id;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Order CRUD
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * @param {Object} params
   * @param {string} params.restaurantId
   * @param {string} params.customerId
   * @param {Array} params.items - [{ name, quantity, priceCents }]
   * @param {string} params.paymentMethod - 'card' | 'cash' | 'spei'
   * @returns {string} orderId
   */
  createOrder({ restaurantId, customerId, items = [], paymentMethod = 'card' }) {
    const restaurant = this.restaurants.get(restaurantId);
    const customer = this.customers.get(customerId);
    if (!restaurant || !customer) throw new Error('Restaurante o cliente no existe');

    const id = this._nextOrderId();
    const totalCents = items.reduce((sum, i) => sum + (i.priceCents * i.quantity), 0);

    const order = {
      id,
      status: 'created',
      restaurant_id: restaurantId,
      restaurant_name: restaurant.name,
      restaurant_lat: restaurant.lat,
      restaurant_lng: restaurant.lng,
      customer_id: customerId,
      customer_name: customer.name,
      customer_lat: customer.lat,
      customer_lng: customer.lng,
      delivery_lat: customer.lat,
      delivery_lng: customer.lng,
      items: items.map(i => ({ ...i, menuItemId: `item_${Date.now()}_${Math.random()}` })),
      total_cents: totalCents,
      payment_method: paymentMethod,
      restaurant_confirmed: false,
      kitchen_estimated_ready: null,
      prep_started_at: null,
      picked_up_at: null,
      delivered_at: null,
      driver_id: null,
      is_disputed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.orders.set(id, order);
    customer.activeOrderId = id;
    restaurant.activeOrders.push(id);

    this.eventBus.emit('order_created', { orderId: id, order });
    this._logOrder('created', { orderId: id, restaurantId, customerId, totalCents });

    return id;
  }

  /**
   * Actualiza estado de un pedido.
   * Estados: created → assigned → accepted → preparing → ready → on_the_way → delivered
   *
   * @param {string} orderId
   * @param {string} status
   * @param {Object} extra - campos adicionales (ej. picked_up_at)
   */
  updateOrderStatus(orderId, status, extra = {}) {
    const order = this.orders.get(orderId);
    if (!order) return false;
    if (order.status === 'delivered' || order.status === 'cancelled') return false;

    const oldStatus = order.status;
    order.status = status;
    order.updated_at = new Date().toISOString();
    Object.assign(order, extra);

    // Timestamps específicos
    if (status === 'preparing' && !order.prep_started_at) {
      order.prep_started_at = new Date().toISOString();
      // kitchen_estimated_ready = ahora + prep_time_estimate_s
      const restaurant = this.restaurants.get(order.restaurant_id);
      if (restaurant) {
        const readyAt = new Date(Date.now() + restaurant.prep_time_estimate_s * 1000);
        order.kitchen_estimated_ready = readyAt.toISOString();
      }
    }

    if (status === 'ready' && !order.ready_at) {
      order.ready_at = new Date().toISOString();
    }

    if (status === 'on_the_way' && !order.picked_up_at) {
      order.picked_up_at = new Date().toISOString();
    }

    if (status === 'delivered' && !order.delivered_at) {
      order.delivered_at = new Date().toISOString();
      // Limpiar activeOrderId del cliente
      const customer = this.customers.get(order.customer_id);
      if (customer && customer.activeOrderId === orderId) {
        customer.activeOrderId = null;
      }
    }

    this.eventBus.emit('order_status_changed', { orderId, oldStatus, newStatus: status, order });
    this._logOrder('status_change', { orderId, from: oldStatus, to: status });

    return true;
  }

  /**
   * Asigna un driver a un pedido.
   * @param {string} driverId
   * @param {string} orderId
   */
  assignDriverToOrder(driverId, orderId) {
    const driver = this.drivers.get(driverId);
    const order = this.orders.get(orderId);
    if (!driver || !order) return false;
    if (order.driver_id) return false;

    order.driver_id = driverId;
    order.status = 'assigned';
    driver.activeOrders.push(orderId);

    this.eventBus.emit('order_assigned', { orderId, driverId, order });
    this._logOrder('assigned', { orderId, driverId });

    return true;
  }

  /**
   * Libera un driver de un pedido (relevo/cancelación).
   * @param {string} driverId
   * @param {string} orderId
   * @param {string} reason
   */
  releaseDriverFromOrder(driverId, orderId, reason = 'manual') {
    const driver = this.drivers.get(driverId);
    const order = this.orders.get(orderId);
    if (!driver || !order) return false;
    if (order.driver_id !== driverId) return false;

    const idx = driver.activeOrders.indexOf(orderId);
    if (idx !== -1) driver.activeOrders.splice(idx, 1);

    order.driver_id = null;
    order.is_disputed = true;

    this.eventBus.emit('order_released', { orderId, driverId, reason });
    this._logOrder('released', { orderId, driverId, reason });

    return true;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Preferencias de ruta
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * @param {string} driverId
   * @param {Object} way - { way_id, name, coords, estimated_duration? }
   */
  addImpassableWay(driverId, way) {
    const driver = this.drivers.get(driverId);
    if (!driver) return false;
    if (!driver.impassableWays.some(w => w.way_id === way.way_id)) {
      driver.impassableWays.push({ ...way, added_at: Date.now() });
      this.eventBus.emit('impassable_added', { driverId, way });
    }
    return true;
  }

  /**
   * @param {string} driverId
   * @param {string} wayId
   */
  removeImpassableWay(driverId, wayId) {
    const driver = this.drivers.get(driverId);
    if (!driver) return false;
    const idx = driver.impassableWays.findIndex(w => w.way_id === wayId);
    if (idx !== -1) {
      driver.impassableWays.splice(idx, 1);
      this.eventBus.emit('impassable_removed', { driverId, wayId });
    }
    return true;
  }

  /**
   * @param {string} driverId
   * @param {Object} way - { way_id, name, coords, preference }
   */
  addRoutePreference(driverId, way) {
    const driver = this.drivers.get(driverId);
    if (!driver) return false;
    if (!driver.routePreferences.some(w => w.way_id === way.way_id)) {
      driver.routePreferences.push({ ...way, added_at: Date.now() });
      this.eventBus.emit('preference_added', { driverId, way });
    }
    return true;
  }

  /**
   * @param {string} driverId
   * @param {string} wayId
   */
  removeRoutePreference(driverId, wayId) {
    const driver = this.drivers.get(driverId);
    if (!driver) return false;
    const idx = driver.routePreferences.findIndex(w => w.way_id === wayId);
    if (idx !== -1) {
      driver.routePreferences.splice(idx, 1);
      this.eventBus.emit('preference_removed', { driverId, wayId });
    }
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Logging interno
  // ──────────────────────────────────────────────────────────────────────────

  _logOrder(type, data) {
    this.eventBus.emit('sim_log_order', { type, data, simTime: this._getSimTime?.() || 0 });
  }

  _logEngine(type, data) {
    this.eventBus.emit('sim_log_engine', { type, data, simTime: this._getSimTime?.() || 0 });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Reset total
  // ──────────────────────────────────────────────────────────────────────────

  reset() {
    this.drivers.clear();
    this.restaurants.clear();
    this.customers.clear();
    this.orders.clear();

    this._driverSeq = 1;
    this._restaurantSeq = 1;
    this._customerSeq = 1;
    this._orderSeq = 1;

    this.eventBus.emit('sim_reset', { timestamp: Date.now() });
    this.eventBus.clear();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Getters útiles
  // ──────────────────────────────────────────────────────────────────────────

  getDriver(driverId) { return this.drivers.get(driverId); }
  getRestaurant(restaurantId) { return this.restaurants.get(restaurantId); }
  getCustomer(customerId) { return this.customers.get(customerId); }
  getOrder(orderId) { return this.orders.get(orderId); }

  getAllDrivers() { return Array.from(this.drivers.values()); }
  getAllRestaurants() { return Array.from(this.restaurants.values()); }
  getAllCustomers() { return Array.from(this.customers.values()); }
  getAllOrders() { return Array.from(this.orders.values()); }

  // Para que MovementEngine pueda inyectar el tiempo simulado
  _setGetSimTime(fn) {
    this._getSimTime = fn;
  }
}

// Singleton export
let instance = null;

export function getSimWorld() {
  if (!instance) {
    instance = new SimWorld();
  }
  return instance;
}

export default SimWorld;
// frontend/src/sim/SimClock.js
// Reloj de simulación con velocidad variable.
// Emite ticks cada 100ms reales → tiempo simulado = speed × 100ms.

class SimClock {
  constructor() {
    this._speed = 1;           // 1x, 2x, 5x, 10x
    this._running = false;
    this._simTime = 0;         // segundos simulados desde el inicio/reset
    this._realStartTime = 0;
    this._simStartTime = 0;
    this._animationId = null;
    this._callbacks = [];      // funciones onTick(simTime, deltaMs)
    this._lastTimestamp = 0;
    this._accumulatedDelta = 0;
  }

  get speed()   { return this._speed; }
  get simTime() { return this._simTime; }
  get running() { return this._running; }

  /**
   * Registra callback que se ejecuta en cada tick simulado.
   * @param {Function} callback - (simTime: number, deltaMs: number) => void
   */
  onTick(callback) {
    this._callbacks.push(callback);
  }

  /**
   * Elimina callback registrado.
   * @param {Function} callback
   */
  offTick(callback) {
    const idx = this._callbacks.indexOf(callback);
    if (idx !== -1) this._callbacks.splice(idx, 1);
  }

  /**
   * Inicia o reanuda el reloj.
   */
  start() {
    if (this._running) return;
    this._running = true;
    this._lastTimestamp = performance.now();
    this._scheduleTick();
  }

  /**
   * Pausa el reloj.
   */
  pause() {
    if (!this._running) return;
    this._running = false;
    if (this._animationId) {
      cancelAnimationFrame(this._animationId);
      this._animationId = null;
    }
  }

  /**
   * Reanuda el reloj (alias de start).
   */
  resume() {
    this.start();
  }

  /**
   * Resetea el tiempo simulado a 0.
   * Si está corriendo, mantiene el estado running pero reinicia el contador.
   */
  reset() {
    const wasRunning = this._running;
    if (wasRunning) this.pause();
    
    this._simTime = 0;
    this._realStartTime = 0;
    this._simStartTime = 0;
    this._lastTimestamp = 0;
    this._accumulatedDelta = 0;
    
    if (wasRunning) this.start();
    
    // Notificar tick 0
    this._notifyTick(0, 0);
  }

  /**
   * Cambia la velocidad del reloj.
   * @param {number} speed - 1, 2, 5, 10
   */
  setSpeed(speed) {
    const validSpeeds = [1, 2, 5, 10];
    if (!validSpeeds.includes(speed)) {
      console.warn(`[SimClock] Velocidad inválida: ${speed}. Usando 1x.`);
      speed = 1;
    }
    
    const wasRunning = this._running;
    if (wasRunning) this.pause();
    
    this._speed = speed;
    
    if (wasRunning) this.start();
  }

  /**
   * @returns {number} Velocidad actual (1, 2, 5, 10)
   */
  getSpeed() {
    return this._speed;
  }

  /**
   * @returns {number} Tiempo simulado en segundos
   */
  getSimTime() {
    return this._simTime;
  }

  /**
   * @returns {boolean} true si el reloj está corriendo
   */
  isRunning() {
    return this._running;
  }

  /**
   * Programa el próximo frame usando requestAnimationFrame.
   */
  _scheduleTick() {
    if (!this._running) return;
    this._animationId = requestAnimationFrame((timestamp) => {
      this._tick(timestamp);
    });
  }

  /**
   * Procesa un frame y acumula delta hasta alcanzar el intervalo de tick (100ms reales).
   * @param {number} now - timestamp real de performance.now()
   */
  _tick(now) {
    if (!this._running) return;

    // Calcular delta real desde el último frame
    const realDeltaMs = Math.min(100, now - this._lastTimestamp); // cap a 100ms
    this._lastTimestamp = now;

    // Acumular delta real
    this._accumulatedDelta += realDeltaMs;

    // Intervalo objetivo: 100ms reales entre ticks simulados
    const TICK_INTERVAL_MS = 100;

    // Procesar tantos ticks como sea necesario (catch up)
    while (this._accumulatedDelta >= TICK_INTERVAL_MS && this._running) {
      // Tiempo simulado avanzado en este tick = TICK_INTERVAL_MS × speed
      const simDeltaMs = TICK_INTERVAL_MS * this._speed;
      this._simTime += simDeltaMs / 1000; // convertir a segundos
      this._accumulatedDelta -= TICK_INTERVAL_MS;

      // Notificar tick
      this._notifyTick(this._simTime, simDeltaMs);
    }

    // Programar próximo frame
    this._scheduleTick();
  }

  /**
   * Notifica a todos los callbacks registrados.
   * @param {number} simTime - tiempo simulado en segundos
   * @param {number} deltaMs - delta simulado en milisegundos (ya multiplicado por speed)
   */
  _notifyTick(simTime, deltaMs) {
    this._callbacks.forEach(cb => {
      try {
        cb(simTime, deltaMs);
      } catch (e) {
        console.warn('[SimClock] Error en callback:', e);
      }
    });
  }

  /**
   * Destruye el reloj y limpia recursos.
   */
  destroy() {
    this.pause();
    this._callbacks = [];
  }
}

// Singleton export
let instance = null;

export function getSimClock() {
  if (!instance) {
    instance = new SimClock();
  }
  return instance;
}

export default SimClock;
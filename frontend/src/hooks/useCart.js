/**
 * useCart.js — Carrito persistente para la app
 * Clave localStorage: brandStorageKey('cart')
 * NO reemplaza ni modifica pendingOrder.js
 *
 * Estructura almacenada:
 * {
 *   restaurantId: string,
 *   items: [{ menuItemId, quantity, name, price_cents }],
 *   total_cents: number
 * }
 */

import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = brandStorageKey('cart');

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Validación mínima de estructura
    if (!parsed?.restaurantId || !Array.isArray(parsed?.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStorage(cart) {
  try {
    if (!cart) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    }
    // Notificar a otras instancias del hook en el mismo tab
    window.dispatchEvent(new Event(brandEventName('cart_updated')));
  } catch {
    // storage lleno o bloqueado — silencioso
  }
}

function computeTotal(items) {
  return items.reduce((sum, item) => sum + item.price_cents * item.quantity, 0);
}

export function useCart() {
  const [cart, setCartState] = useState(() => readStorage());

  // Sincroniza estado React + localStorage en una sola llamada
  const commitCart = useCallback((next) => {
    writeStorage(next);
    setCartState(next);
  }, []);

  /**
   * Agrega un item al carrito sumando `item.quantity` unidades (default: 1).
   * Si el restaurantId difiere del actual, reemplaza el carrito completo.
   * @param {string} restaurantId
   * @param {{ menuItemId: string, name: string, price_cents: number, quantity?: number }} item
   */
  const addItem = useCallback((restaurantId, item) => {
    const qty = Math.max(1, Number(item.quantity) || 1);
    setCartState(prev => {
      let items = (prev?.restaurantId === restaurantId) ? [...prev.items] : [];

      const idx = items.findIndex(i => i.menuItemId === item.menuItemId);
      if (idx >= 0) {
        items[idx] = { ...items[idx], quantity: items[idx].quantity + qty };
      } else {
        items.push({
          menuItemId:  item.menuItemId,
          quantity:    qty,
          name:        item.name,
          price_cents: item.price_cents,
        });
      }

      const next = { restaurantId, items, total_cents: computeTotal(items) };
      writeStorage(next);
      return next;
    });
  }, []);

  /**
   * Ajusta la cantidad de un item en +delta o -delta.
   * Si quantity llega a 0 el item se elimina.
   * Si el carrito queda vacío se limpia completamente.
   * @param {string} menuItemId
   * @param {number} delta  (+1 ó -1)
   */
  const adjustItem = useCallback((menuItemId, delta) => {
    setCartState(prev => {
      if (!prev) return prev;

      let items = prev.items
        .map(i => i.menuItemId === menuItemId
          ? { ...i, quantity: i.quantity + delta }
          : i
        )
        .filter(i => i.quantity > 0);

      const next = items.length === 0
        ? null
        : { ...prev, items, total_cents: computeTotal(items) };

      writeStorage(next);
      return next;
    });
  }, []);

  /**
   * Vacía el carrito completamente (llamar tras checkout exitoso).
   */
  const clearCart = useCallback(() => {
    commitCart(null);
  }, [commitCart]);

  // Sincronizar con otras instancias del hook (ej: RestaurantPage → CustomerCart)
  useEffect(() => {
    function sync() {
      setCartState(readStorage());
    }
    window.addEventListener(brandEventName('cart_updated'), sync);
    window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) sync(); });
    return () => {
      window.removeEventListener(brandEventName('cart_updated'), sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return {
    cart,        // { restaurantId, items, total_cents } | null
    addItem,     // (restaurantId, { menuItemId, name, price_cents, quantity? }) => void
    adjustItem,  // (menuItemId, delta) => void
    clearCart,   // () => void
  };
}

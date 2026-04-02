const DEFAULT_UI_BRAND = 'En Corto';
const DEFAULT_ROUTER_BRAND = 'morelivery';

const sanitize = (value, fallback) => {
  const normalized = String(value || '').trim();
  return normalized || fallback;
};

export const UI_BRAND = sanitize(import.meta.env.VITE_UI_BRAND, DEFAULT_UI_BRAND);
export const ROUTER_BRAND = sanitize(import.meta.env.VITE_ROUTER_BRAND, DEFAULT_ROUTER_BRAND).toLowerCase();

export const brandStorageKey = (suffix) => `${ROUTER_BRAND}_${suffix}`;
export const brandEventName = (suffix) => `${ROUTER_BRAND}:${suffix}`;
export const brandUserAgent = (version = '1.0') => `${UI_BRAND}/${version}`;

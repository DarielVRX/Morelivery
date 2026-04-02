const DEFAULT_UI_BRAND = 'En Corto';
const DEFAULT_ROUTER_BRAND = 'encorto';

const sanitize = (value, fallback) => {
  const normalized = String(value || '').trim();
  return normalized || fallback;
};

export const UI_BRAND = sanitize(process.env.UI_BRAND, DEFAULT_UI_BRAND);
export const ROUTER_BRAND = sanitize(process.env.ROUTER_BRAND, DEFAULT_ROUTER_BRAND).toLowerCase();
export const BACKEND_BASE_URL = process.env.BACKEND_URL || `https://${ROUTER_BRAND}.onrender.com`;
export const SERVICE_NAME = `${ROUTER_BRAND}-api`;
export const DEFAULT_DATABASE_NAME = ROUTER_BRAND;
export const DEFAULT_VAPID_EMAIL = `admin@${ROUTER_BRAND}.com`;

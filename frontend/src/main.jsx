import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles/app.css';
import { ThemeProvider } from './contexts/ThemeContext.jsx';

// ── Service Worker ─────────────────────────────────────────────────────────
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    return reg;
  } catch (_) { return null; }
}

// ── Notificaciones: pre-prompt propio antes del nativo ────────────────────
// Los navegadores solo muestran el prompt nativo UNA vez si se rechaza.
// Mostrar primero un diálogo propio explica por qué se necesita el permiso
// y aumenta significativamente la tasa de aceptación (mejor UX + más alcance).
async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'denied') return;
  // Solo mostrar el diálogo si el usuario no lo rechazó antes
  if (localStorage.getItem('notif_asked') === '1') return;

  // Esperar primera interacción real del usuario (requerido por iOS 16.4+)
  await new Promise(resolve => {
    const handler = () => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
      resolve();
    };
    window.addEventListener('pointerdown', handler, { once: true });
    window.addEventListener('keydown', handler, { once: true });
  });

  // Pequeño delay para que no sea el primer gesto de la app
  await new Promise(r => setTimeout(r, 1200));

  // Mostrar diálogo propio antes del nativo
  let accepted = false;
  if (Notification.permission === 'default') {
    accepted = await showNotificationPrompt();
    localStorage.setItem('notif_asked', '1');
    if (!accepted) return;
  }

  try {
    const result = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    if (result === 'granted') {
      try { localStorage.setItem('morelivery_notif_enabled', '1'); } catch (_) {}
      // Intentar registrar suscripción push (si hay VAPID key disponible)
      await trySubscribePush();
    }
  } catch (_) {}
}

// Diálogo propio — explicativo, más conversión que el nativo directo
function showNotificationPrompt() {
  return new Promise(resolve => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const bg    = isDark ? '#1a1a1a' : '#ffffff';
    const text  = isDark ? '#f3f4f6' : '#1f2937';
    const sub   = isDark ? '#9ca3af' : '#6b7280';
    const brand = '#c97f7f';
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:rgba(0,0,0,0.55);
      display:flex;align-items:flex-end;justify-content:center;
      padding:0 0 env(safe-area-inset-bottom,0px) 0;
      font-family:system-ui,-apple-system,sans-serif;
    `;
    overlay.innerHTML = `
      <div style="
        background:${bg};border-radius:18px 18px 0 0;
        padding:1.5rem 1.25rem 1.75rem;width:100%;max-width:480px;
        box-shadow:0 -4px 32px rgba(0,0,0,0.3);
      ">
        <div style="font-size:2rem;text-align:center;margin-bottom:0.5rem">🔔</div>
        <h3 style="font-size:1.05rem;font-weight:800;text-align:center;margin:0 0 0.4rem;color:${text}">
          Activar notificaciones
        </h3>
        <p style="font-size:0.875rem;color:${sub};text-align:center;margin:0 0 1.25rem;line-height:1.5">
          Recibe alertas de pedidos nuevos, actualizaciones de estado y mensajes en tiempo real — incluso cuando la app está en segundo plano.
        </p>
        <div style="display:flex;flex-direction:column;gap:0.6rem">
          <button id="notif-yes" style="
            background:${brand};color:#fff;border:none;border-radius:10px;
            padding:0.75rem;font-size:0.95rem;font-weight:700;cursor:pointer;
          ">Activar notificaciones</button>
          <button id="notif-no" style="
            background:none;border:none;color:${sub};
            padding:0.5rem;font-size:0.875rem;cursor:pointer;
          ">Ahora no</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#notif-yes').onclick = () => { document.body.removeChild(overlay); resolve(true); };
    overlay.querySelector('#notif-no').onclick  = () => { document.body.removeChild(overlay); resolve(false); };
  });
}
    document.body.appendChild(overlay);
    overlay.querySelector('#notif-yes').onclick = () => { document.body.removeChild(overlay); resolve(true); };
    overlay.querySelector('#notif-no').onclick  = () => { document.body.removeChild(overlay); resolve(false); };
  });
}

// Suscripción Web Push VAPID (cuando esté implementado en backend)
async function trySubscribePush() {
  try {
    const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
    if (!vapidKey) return; // No hay key configurada aún
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) return; // Ya suscrito
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
    // Enviar suscripción al backend
    const token = JSON.parse(localStorage.getItem('morelivery_auth_v1') || '{}')?.token;
    if (!token) return;
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${token}` },
      body: JSON.stringify(sub),
    });
  } catch (_) {}
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ── Boot ──────────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    registerServiceWorker();
    requestNotificationPermission();
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);

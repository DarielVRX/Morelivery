import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles/app.css';

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch (_) {}
}

function setupNotificationPermissionPrompt() {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'default') return;
  if (localStorage.getItem('notif_prompt_dismissed') === '1') return;

  const requestPermission = () => {
    if (Notification.permission !== 'default') return;
    Notification.requestPermission().catch(() => {});
    localStorage.setItem('notif_prompt_dismissed', '1');
  };

  window.addEventListener('pointerdown', requestPermission, { once: true });
  window.addEventListener('keydown', requestPermission, { once: true });
}

if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    registerServiceWorker();
    setupNotificationPermissionPrompt();
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

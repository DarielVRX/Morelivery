// frontend/src/features/admin/dashboard/tabs/SystemTab.jsx
import { useCallback, useEffect, useState, useRef } from 'react';
import { apiFetch } from '../../../../api/client';
import { useAuth } from '../../../../contexts/AuthContext';

// Funciones auxiliares
async function requestNotificationPermissionTest() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  const result = await Notification.requestPermission();
  return result;
}

async function testPushNotification(token) {
  try {
    await apiFetch('/admin/test-push', { method: 'POST' }, token);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function getBatteryStatus() {
  if (!('getBattery' in navigator)) return null;
  try {
    const battery = await navigator.getBattery();
    return {
      level: Math.round(battery.level * 100),
      charging: battery.charging,
      chargingTime: battery.chargingTime,
      dischargingTime: battery.dischargingTime,
    };
  } catch {
    return null;
  }
}

function getNetworkInfo() {
  if (!('connection' in navigator)) return null;
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return {
    type: conn.type,
    effectiveType: conn.effectiveType,
    downlink: conn.downlink,
    rtt: conn.rtt,
    saveData: conn.saveData,
  };
}

async function testClipboard() {
  if (!navigator.clipboard?.writeText) return 'unsupported';
  try {
    await navigator.clipboard.writeText('Morelivery test');
    const read = await navigator.clipboard.readText().catch(() => null);
    return read !== null ? 'read+write' : 'write-only';
  } catch (e) {
    if (e.name === 'NotAllowedError') return 'denied';
    return 'error';
  }
}

async function testCameraWithPreview(videoRef, setCameraStatus) {
  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraStatus('unsupported');
    return null;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play();
    }
    setCameraStatus('granted');
    return stream;
  } catch (err) {
    if (err.name === 'NotAllowedError') setCameraStatus('denied');
    else setCameraStatus('error');
    return null;
  }
}

function formatBattery(battery) {
  if (!battery) return 'No disponible';
  let text = `${battery.level}%`;
  if (battery.charging) text += ' (Cargando)';
  if (battery.dischargingTime !== Infinity && battery.dischargingTime > 0) {
    const mins = Math.round(battery.dischargingTime / 60);
    text += ` · Autonomía: ${mins} min`;
  } else if (battery.charging) {
    // No mostrar autonomía si está cargando
  } else if (battery.dischargingTime === Infinity) {
    text += ' · Autonomía infinita (enchufado)';
  }
  return text;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function requestPushSubscription(token) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, error: 'Push no soportado' };
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
      if (!vapidKey) return { ok: false, error: 'Falta clave VAPID en frontend' };
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
    }
    await apiFetch('/auth/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(sub.toJSON()),
    }, token);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export default function SystemTab({ onMessage }) {
  const { auth } = useAuth();
  const videoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [cameraPreview, setCameraPreview] = useState(false);
  const [status, setStatus] = useState({
    sseConnected: 0,
    sseByRole: {},
    swActive: false,
    pushSubscribed: false,
    geolocation: 'unknown',
    persistentStorage: 'unknown',
    wakeLock: 'unsupported',
    clipboard: 'unknown',
    battery: null,
    network: null,
    camera: 'unknown',
    testPushResult: null,
  });

  const refreshStatus = useCallback(async () => {
    if (!auth.token) return;
    setLoading(true);
    try {
      // 1. SSE
      try {
        const sse = await apiFetch('/admin/sse-status', {}, auth.token);
        setStatus(prev => ({ ...prev, sseConnected: sse.connected, sseByRole: sse.byRole }));
      } catch (e) { console.warn(e); }

      // 2. Service Worker
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        setStatus(prev => ({ ...prev, swActive: !!reg?.active }));
      }

      // 3. Push subscription
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setStatus(prev => ({ ...prev, pushSubscribed: !!sub }));
      }

      // 4. Geolocation
      if ('geolocation' in navigator && navigator.permissions?.query) {
        const perm = await navigator.permissions.query({ name: 'geolocation' });
        setStatus(prev => ({ ...prev, geolocation: perm.state }));
      }

      // 5. Persistent storage
      if (navigator.storage?.persisted) {
        const persisted = await navigator.storage.persisted();
        setStatus(prev => ({ ...prev, persistentStorage: persisted ? 'granted' : 'denied' }));
      }

      // 6. Wake Lock
      setStatus(prev => ({ ...prev, wakeLock: 'wakeLock' in navigator ? 'supported' : 'unsupported' }));

      // 7. Clipboard
      const clipStatus = await testClipboard();
      setStatus(prev => ({ ...prev, clipboard: clipStatus }));

      // 8. Battery
      const battery = await getBatteryStatus();
      setStatus(prev => ({ ...prev, battery }));

      // 9. Network
      setStatus(prev => ({ ...prev, network: getNetworkInfo() }));

      // 10. Camera
      if (navigator.mediaDevices?.getUserMedia) {
        if (navigator.permissions?.query) {
          const perm = await navigator.permissions.query({ name: 'camera' });
          setStatus(prev => ({ ...prev, camera: perm.state }));
        }
      } else {
        setStatus(prev => ({ ...prev, camera: 'unsupported' }));
      }
    } catch (e) {
      onMessage?.(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [auth.token, onMessage]);

  const handleTestPush = async () => {
    setStatus(prev => ({ ...prev, testPushResult: null }));
    const result = await testPushNotification(auth.token);
    setStatus(prev => ({ ...prev, testPushResult: result }));
    if (result.ok) {
      onMessage?.('Notificación push enviada (revisa tu dispositivo)');
    } else {
      onMessage?.(`Error: ${result.error}`);
    }
    setTimeout(() => setStatus(prev => ({ ...prev, testPushResult: null })), 5000);
  };

  const handleRequestPushSubscription = async () => {
    const result = await requestPushSubscription(auth.token);
    if (result.ok) {
      onMessage?.('✅ Suscripción push registrada');
      refreshStatus();
    } else {
      onMessage?.(`❌ Error: ${result.error}`);
    }
  };

  const handleToggleWakeLock = async () => {
    if (!('wakeLock' in navigator)) {
      onMessage?.('Wake Lock no soportado en este navegador');
      return;
    }
    try {
      if (window.wakeLockSentinel) {
        await window.wakeLockSentinel.release();
        window.wakeLockSentinel = null;
        setStatus(prev => ({ ...prev, wakeLock: 'released' }));
      } else {
        const lock = await navigator.wakeLock.request('screen');
        window.wakeLockSentinel = lock;
        setStatus(prev => ({ ...prev, wakeLock: 'active' }));
        lock.addEventListener('release', () => {
          window.wakeLockSentinel = null;
          setStatus(prev => ({ ...prev, wakeLock: 'supported' }));
        });
      }
    } catch (e) {
      onMessage?.(`Wake Lock error: ${e.message}`);
    }
  };

  const handleCameraTest = async () => {
    if (cameraPreview) {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(track => track.stop());
        cameraStreamRef.current = null;
      }
      setCameraPreview(false);
    } else {
      const stream = await testCameraWithPreview(videoRef, (state) => setStatus(prev => ({ ...prev, camera: state })));
      if (stream) {
        cameraStreamRef.current = stream;
        setCameraPreview(true);
      } else {
        onMessage?.('No se pudo acceder a la cámara');
      }
    }
  };

  useEffect(() => {
    return () => {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  return (
    <div>
    <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
    <button onClick={refreshStatus} disabled={loading} style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
    {loading ? 'Actualizando…' : '↻ Actualizar estado'}
    </button>
    <button onClick={handleTestPush} style={{ padding: '0.4rem 0.8rem', background: 'var(--brand)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
    📢 Probar notificación push
    </button>
    {!status.pushSubscribed && (
      <button onClick={handleRequestPushSubscription} style={{ padding: '0.4rem 0.8rem', background: '#f59e0b', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
      🔔 Activar push
      </button>
    )}
    <button onClick={handleToggleWakeLock} style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
    {status.wakeLock === 'active' ? '🔓 Liberar Wake Lock' : '🔒 Activar Wake Lock'}
    </button>
    </div>

    {status.testPushResult && (
      <div className={`flash ${status.testPushResult.ok ? 'flash-ok' : 'flash-error'}`} style={{ marginBottom: '1rem' }}>
      {status.testPushResult.ok ? '✅ Notificación push enviada' : `❌ Error: ${status.testPushResult.error}`}
      </div>
    )}

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
    {/* SSE */}
    <div className="card" style={{ padding: '0.8rem', border: '1px solid var(--border)', borderRadius: 8 }}>
    <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>📡 SSE</div>
    <div>Conectados: <strong>{status.sseConnected}</strong></div>
    <div>Por rol: {Object.entries(status.sseByRole).map(([r, c]) => `${r}:${c}`).join(', ')}</div>
    </div>

    {/* Service Worker */}
    <div className="card" style={{ padding: '0.8rem', border: '1px solid var(--border)', borderRadius: 8 }}>
    <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>⚙️ Service Worker</div>
    <div>Estado: {status.swActive ? '✅ Activo' : '❌ Inactivo'}</div>
    </div>

    {/* Push Subscription */}
    <div className="card" style={{ padding: '0.8rem', border: '1px solid var(--border)', borderRadius: 8 }}>
    <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>🔔 Push</div>
    <div>Suscripción: {status.pushSubscribed ? '✅ Activa' : '❌ No suscrita'}</div>
    {!status.pushSubscribed && (
      <button onClick={handleRequestPushSubscription} style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
      Registrar suscripción
      </button>
    )}
    </div>

    {/* Geolocation */}
    <div className="card" style={{ padding: '0.8rem', border: '1px solid var(--border)', borderRadius: 8 }}>
    <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>📍 Geolocalización</div>
    <div>Estado: <strong>{status.geolocation}</strong></div>
    </div>

    {/* Persistent Storage */}
    <div className="card" style={{ padding: '0.8rem', border: '1px solid var(--border)', borderRadius: 8 }}>
    <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>💾 Almacenamiento persistente</div>
    <div>Estado: <strong>{status.persistentStorage === 'granted' ? '✅ Activo' : '❌ No activado'}</strong></div>
    </div>

    {/* Wake Lock */}
    <div className="card" style={{ padding: '0.8rem', border: '1px solid var(--border)', borderRadius: 8 }}>
    <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>🔋 Wake Lock</div>
    <div>Soporte: {status.wakeLock === 'unsupported' ? '❌ No soportado' : '✅ Soportado'}</div>
    {status.wakeLock !== 'unsupported' && <div>Estado actual: {status.wakeLock === 'active' ? '🟢 Activo' : '⚪ Inactivo'}</div>}
    </div>

    {/* Clipboard */}
    <div className="card" style={{ padding: '0.8rem', border: '1px solid var(--border)', borderRadius: 8 }}>
    <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>📋 Clipboard</div>
    <div>Permiso: <strong>{status.clipboard}</strong></div>
    </div>

    {/* Cámara */}
    <div className="card" style={{ padding: '0.8rem', border: '1px solid var(--border)', borderRadius: 8 }}>
    <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>📷 Cámara</div>
    <div>Estado: <strong>{status.camera}</strong></div>
    <button onClick={handleCameraTest} style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
    {cameraPreview ? 'Cerrar cámara' : 'Probar cámara'}
    </button>
    {cameraPreview && (
      <div style={{ marginTop: '0.5rem', width: '100%', background: '#000', borderRadius: 4, overflow: 'hidden' }}>
      <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: 'auto', maxHeight: 200 }} />
      </div>
    )}
    </div>

    {/* Battery */}
    <div className="card" style={{ padding: '0.8rem', border: '1px solid var(--border)', borderRadius: 8 }}>
    <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>🔋 Batería</div>
    <div>{formatBattery(status.battery)}</div>
    </div>

    {/* Network */}
    <div className="card" style={{ padding: '0.8rem', border: '1px solid var(--border)', borderRadius: 8 }}>
    <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>🌐 Red</div>
    {status.network ? (
      <>
      <div>Tipo: {status.network.type || status.network.effectiveType || 'desconocido'}</div>
      <div>Velocidad: {status.network.downlink ? `${status.network.downlink} Mbps` : '—'}</div>
      <div>RTT: {status.network.rtt ? `${status.network.rtt} ms` : '—'}</div>
      <div>Modo ahorro: {status.network.saveData ? 'Activado' : 'Desactivado'}</div>
      </>
    ) : (
      <div>No disponible</div>
    )}
    </div>
    </div>
    </div>
  );
}

// frontend/src/features/admin/dashboard/tabs/SystemTab.jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../../api/client';
import { useAuth } from '../../../../contexts/AuthContext';

// ─── Helpers — Browser API readers ────────────────────────────────────────────

function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function readGeoPermission() {
  if (!('geolocation' in navigator)) return 'unsupported';
  if (navigator.permissions?.query) {
    try {
      const p = await navigator.permissions.query({ name: 'geolocation' });
      return p.state;
    } catch { return 'unknown'; }
  }
  return 'unknown';
}

async function readNotifPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

async function readPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch { return false; }
}

async function readSwState() {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 'not_registered';
  if (reg.active) return 'active';
  if (reg.installing) return 'installing';
  if (reg.waiting) return 'waiting';
  return 'registered';
}

async function readStoragePersisted() {
  if (!navigator.storage?.persisted) return 'unsupported';
  const p = await navigator.storage.persisted();
  return p ? 'granted' : 'denied';
}

async function readClipboardPermission() {
  if (!navigator.clipboard) return 'unsupported';
  if (navigator.permissions?.query) {
    try {
      const p = await navigator.permissions.query({ name: 'clipboard-read' });
      return p.state;
    } catch { /* fall through */ }
  }
  try {
    await navigator.clipboard.writeText('');
    return 'granted';
  } catch { return 'unknown'; }
}

async function readBattery() {
  if (!('getBattery' in navigator)) return null;
  try {
    const b = await navigator.getBattery();
    return { level: Math.round(b.level * 100), charging: b.charging, dischargingTime: b.dischargingTime };
  } catch { return null; }
}

function readNetwork() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn) return null;
  return { effectiveType: conn.effectiveType, downlink: conn.downlink, rtt: conn.rtt, saveData: conn.saveData };
}

async function readMicPermission() {
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  if (navigator.permissions?.query) {
    try {
      const p = await navigator.permissions.query({ name: 'microphone' });
      return p.state;
    } catch { /* fall through */ }
  }
  return 'unknown';
}

function readVibrationSupport() {
  if (!('vibrate' in navigator)) return 'unsupported';
  return 'supported';
}

async function readBackgroundSyncSupport() {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!('sync' in reg)) return 'unsupported';
    return 'supported';
  } catch { return 'unsupported'; }
}

function readBluetoothSupport() {
  if (!('bluetooth' in navigator)) return 'unsupported';
  return 'supported';
}

function readFileSystemSupport() {
  if (!('showOpenFilePicker' in window)) return 'unsupported';
  return 'supported';
}

async function readSyncQueueLength() {
  try {
    const cache = await caches.open('morelivery-sync-queue');
    const resp = await cache.match('queue');
    if (!resp) return 0;
    const queue = await resp.json();
    return queue.length;
  } catch { return 0; }
}

// ─── Status badge ──────────────────────────────────────────────────────────────
function Badge({ state }) {
  const map = {
    granted:     ['#dcfce7', '#166534', '✅'],
    active:      ['#dcfce7', '#166534', '✅'],
    supported:   ['#dcfce7', '#166534', '✅'],
    prompt:      ['#fef9c3', '#854d0e', '⚠️'],
    default:     ['#fef9c3', '#854d0e', '⚠️'],
    denied:      ['#fee2e2', '#991b1b', '❌'],
    unsupported: ['#f3f4f6', '#6b7280', '—'],
    unknown:     ['#f3f4f6', '#6b7280', '?'],
  };
  const [bg, color, icon] = map[state] ?? ['#f3f4f6', '#6b7280', state];
  return (
    <span style={{ background: bg, color, borderRadius: 6, padding: '0.15rem 0.5rem', fontSize: '0.75rem', fontWeight: 700 }}>
      {icon} {state}
    </span>
  );
}

function Card({ title, children }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.85rem 1rem' }}>
      <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.6rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Btn({ onClick, disabled, children, variant = 'default' }) {
  const styles = {
    default: { background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)' },
    primary: { background: 'var(--brand)', color: '#fff', border: 'none' },
    warning: { background: '#f59e0b', color: '#fff', border: 'none' },
    danger:  { background: 'var(--danger)', color: '#fff', border: 'none' },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ ...styles[variant], borderRadius: 7, padding: '0.3rem 0.7rem', fontSize: '0.78rem', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, fontWeight: 600 }}
    >
      {children}
    </button>
  );
}

function Note({ children }) {
  return (
    <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', marginTop: '0.4rem', lineHeight: 1.4 }}>
      {children}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function SystemTab({ onMessage }) {
  const { auth } = useAuth();
  const videoRef        = useRef(null);
  const cameraStreamRef = useRef(null);
  const micStreamRef    = useRef(null);
  const mediaRecorderRef = useRef(null);
  const wakeLockRef     = useRef(null);
  const canvasRef       = useRef(null);

  const [loading, setLoading]           = useState(false);
  const [cameraOpen, setCameraOpen]     = useState(false);
  const [cameraFacing, setCameraFacing] = useState('environment');
  const [flashOn, setFlashOn]           = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const [geoResult, setGeoResult]       = useState(null);
  const [clipResult, setClipResult]     = useState(null);
  const [pushSending, setPushSending]   = useState(false);

  // Mic state
  const [micRecording, setMicRecording] = useState(false);
  const [micAudioUrl, setMicAudioUrl]   = useState(null);
  const [micChunks, setMicChunks]       = useState([]);

  // File System state
  const [fsFileName, setFsFileName]     = useState(null);

  // Bluetooth state
  const [btDevice, setBtDevice]         = useState(null);

  const [s, setS] = useState({
    // SSE
    sseConnected: null,
    sseByRole: {},
    // Browser APIs
    sw:           'unknown',
    notifications:'unknown',
    push:         null,
    geolocation:  'unknown',
    storage:      'unknown',
    wakeLock:     'unknown',
    clipboard:    'unknown',
    battery:      null,
    network:      null,
    camera:       'unknown',
    // New
    microphone:   'unknown',
    vibration:    'unknown',
    backgroundSync: 'unknown',
    bluetooth:    'unknown',
    fileSystem:   'unknown',
    syncQueueLength: 0,
  });

  // ── Refresh all ─────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [sw, notif, push, geo, storage, clip, battery, mic, bgSync, queueLen] = await Promise.all([
        readSwState(),
        readNotifPermission(),
        readPushSubscription(),
        readGeoPermission(),
        readStoragePersisted(),
        readClipboardPermission(),
        readBattery(),
        readMicPermission(),
        readBackgroundSyncSupport(),
        readSyncQueueLength(),
      ]);

      const wl = !('wakeLock' in navigator) ? 'unsupported'
               : wakeLockRef.current ? 'active' : 'supported';

      let cam = 'unknown';
      if (!navigator.mediaDevices?.getUserMedia) cam = 'unsupported';
      else if (navigator.permissions?.query) {
        try { const p = await navigator.permissions.query({ name: 'camera' }); cam = p.state; } catch { /* ok */ }
      }

      setS(prev => ({
        ...prev,
        sw, notifications: notif, push, geolocation: geo,
        storage, clipboard: clip, battery, network: readNetwork(),
        wakeLock: wl, camera: cam,
        microphone: mic,
        vibration: readVibrationSupport(),
        backgroundSync: bgSync,
        bluetooth: readBluetoothSupport(),
        fileSystem: readFileSystemSupport(),
        syncQueueLength: queueLen,
      }));

      try {
        const sse = await apiFetch('/admin/sse-status', {}, auth.token);
        setS(prev => ({ ...prev, sseConnected: sse.connected, sseByRole: sse.byRole }));
      } catch { /* endpoint may not exist yet */ }

    } finally {
      setLoading(false);
    }
  }, [auth.token]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Actions — existing ───────────────────────────────────────────────────────

  const requestNotifications = async () => {
    if (!('Notification' in window)) return onMessage?.('❌ No soportado');
    const result = await Notification.requestPermission();
    setS(prev => ({ ...prev, notifications: result }));
    if (result === 'granted') { onMessage?.('✅ Notificaciones concedidas'); fireTestNotif(); }
    else onMessage?.(`⚠️ Resultado: ${result}`);
  };

  const fireTestNotif = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      reg.active?.postMessage({ type: 'TEST_NOTIFICATION', title: 'Morelivery', body: 'Notificaciones funcionando ✓', tag: 'test' });
      onMessage?.('🔔 Notificación enviada al SW');
    } catch (e) { onMessage?.(`❌ ${e.message}`); }
  };

  const testVoiceReminders = async () => {
    try {
      await apiFetch('/admin/schedule-voice-reminders', { method: 'POST' }, auth.token);
      onMessage?.('🎤 Programado: push en 30s y en 5 minutos');
    } catch (e) { onMessage?.(`❌ ${e.message}`); }
  };

  const requestPush = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window))
      return onMessage?.('❌ Push no soportado');
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
        if (!key) return onMessage?.('❌ Falta VITE_VAPID_PUBLIC_KEY');
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      }
      await apiFetch('/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) }, auth.token);
      setS(prev => ({ ...prev, push: true }));
      onMessage?.('✅ Suscripción push registrada en servidor');
    } catch (e) { onMessage?.(`❌ ${e.message}`); }
  };

  const testPush = async () => {
    setPushSending(true);
    try {
      await apiFetch('/admin/test-push', { method: 'POST' }, auth.token);
      onMessage?.('📨 Push enviado — revisa tu dispositivo');
    } catch (e) { onMessage?.(`❌ ${e.message}`); }
    finally { setPushSending(false); }
  };

  const requestGeo = async () => {
    if (!('geolocation' in navigator)) return onMessage?.('❌ No soportado');
    setGeoResult(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const r = { lat: pos.coords.latitude.toFixed(5), lng: pos.coords.longitude.toFixed(5), accuracy: Math.round(pos.coords.accuracy) };
        setGeoResult(r);
        setS(prev => ({ ...prev, geolocation: 'granted' }));
        onMessage?.(`📍 Posición: ${r.lat}, ${r.lng} (±${r.accuracy}m)`);
      },
      (err) => {
        setS(prev => ({ ...prev, geolocation: err.code === 1 ? 'denied' : 'error' }));
        onMessage?.(`❌ Geolocalización: ${err.message}`);
      },
      { timeout: 8000, maximumAge: 0, enableHighAccuracy: true }
    );
  };

  const requestStorage = async () => {
    if (!navigator.storage?.persist) return onMessage?.('❌ No soportado');
    const granted = await navigator.storage.persist();
    setS(prev => ({ ...prev, storage: granted ? 'granted' : 'denied' }));
    onMessage?.(granted ? '✅ Almacenamiento persistente activado' : '⚠️ El navegador denegó persistencia');
  };

  const toggleWakeLock = async () => {
    if (!('wakeLock' in navigator)) return onMessage?.('❌ No soportado');
    if (wakeLockRef.current) {
      await wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
      setS(prev => ({ ...prev, wakeLock: 'supported' }));
      onMessage?.('Wake Lock liberado');
    } else {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        setS(prev => ({ ...prev, wakeLock: 'active' }));
        onMessage?.('🔒 Wake Lock activo — la pantalla no se apagará');
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null;
          setS(prev => ({ ...prev, wakeLock: 'supported' }));
        });
      } catch (e) { onMessage?.(`❌ ${e.message}`); }
    }
  };

  const testClipboard = async () => {
    const text = `morelivery-test-${Date.now()}`;
    try {
      await navigator.clipboard.writeText(text);
      const read = await navigator.clipboard.readText();
      setClipResult(read);
      setS(prev => ({ ...prev, clipboard: 'granted' }));
      onMessage?.(read === text ? '✅ Clipboard: escritura y lectura OK' : '⚠️ Clipboard: escritura OK pero lectura difiere');
    } catch (e) { onMessage?.(`❌ Clipboard: ${e.message}`); }
  };

  const toggleCamera = async () => {
    if (cameraOpen) {
      cameraStreamRef.current?.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
      setCameraOpen(false);
      setCapturedPhoto(null);
      setFlashOn(false);
    } else {
      await startCamera(cameraFacing);
    }
  };

  const startCamera = async (facing) => {
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    cameraStreamRef.current = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      setCameraOpen(true);
      setCameraFacing(facing);
      setS(prev => ({ ...prev, camera: 'granted' }));
    } catch (e) {
      setS(prev => ({ ...prev, camera: e.name === 'NotAllowedError' ? 'denied' : 'error' }));
      onMessage?.(`❌ Cámara: ${e.message}`);
    }
  };

  const flipCamera  = async () => startCamera(cameraFacing === 'environment' ? 'user' : 'environment');

  const toggleFlash = async () => {
    const track = cameraStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !flashOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setFlashOn(next);
    } catch { onMessage?.('⚠️ Flash no disponible en este dispositivo'); }
  };

  const takePhoto = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = canvasRef.current || document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    setCapturedPhoto(canvas.toDataURL('image/jpeg', 0.92));
  };

  // ── Actions — NEW ────────────────────────────────────────────────────────────

  // — Micrófono —
  const toggleMic = async () => {
    if (micRecording) {
      // Detener grabación
      mediaRecorderRef.current?.stop();
      return;
    }
    setMicAudioUrl(null);
    setMicChunks([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      setS(prev => ({ ...prev, microphone: 'granted' }));

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      const chunks = [];

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        micStreamRef.current = null;
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setMicAudioUrl(URL.createObjectURL(blob));
        setMicRecording(false);
        onMessage?.('🎤 Grabación completada — reproduciéndola');
      };

      recorder.start();
      setMicRecording(true);
      onMessage?.('🎙️ Grabando… pulsa "Detener" para terminar');
    } catch (e) {
      setS(prev => ({ ...prev, microphone: e.name === 'NotAllowedError' ? 'denied' : 'error' }));
      onMessage?.(`❌ Micrófono: ${e.message}`);
    }
  };

  // — Vibración —
  const testVibration = (pattern, label) => {
    if (!('vibrate' in navigator)) return onMessage?.('❌ Vibración no soportada');
    navigator.vibrate(pattern);
    onMessage?.(`📳 Patrón: ${label}`);
  };

  // — Background Sync — ver cola actual + test de encolado —
  const testEnqueueSync = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      reg.active?.postMessage({
        type:   'ENQUEUE_REQUEST',
        url:    '/api/sync/test',
        method: 'POST',
        body:   JSON.stringify({ test: true, ts: Date.now() }),
        token:  auth.token,
      });
      // Dar tiempo al SW para escribir
      await new Promise(r => setTimeout(r, 300));
      const len = await readSyncQueueLength();
      setS(prev => ({ ...prev, syncQueueLength: len }));
      onMessage?.(`📶 Petición encolada. Cola actual: ${len} ítem(s)`);
    } catch (e) { onMessage?.(`❌ Sync: ${e.message}`); }
  };

  const clearSyncQueue = async () => {
    try {
      const cache = await caches.open('morelivery-sync-queue');
      await cache.put('queue', new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } }));
      setS(prev => ({ ...prev, syncQueueLength: 0 }));
      onMessage?.('🗑️ Cola de sync vaciada');
    } catch (e) { onMessage?.(`❌ ${e.message}`); }
  };

  // — Bluetooth —
  const requestBluetooth = async () => {
    if (!('bluetooth' in navigator)) return onMessage?.('❌ Web Bluetooth no soportado en este navegador');
    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['battery_service', 'device_information'],
      });
      setBtDevice({ name: device.name || 'Sin nombre', id: device.id });
      setS(prev => ({ ...prev, bluetooth: 'granted' }));
      onMessage?.(`🔵 Bluetooth: dispositivo "${device.name || 'Sin nombre'}" seleccionado`);
    } catch (e) {
      if (e.name === 'NotFoundError') onMessage?.('⚠️ Bluetooth: ningún dispositivo seleccionado');
      else onMessage?.(`❌ Bluetooth: ${e.message}`);
    }
  };

  // — File System Access —
  const testFileOpen = async () => {
    if (!('showOpenFilePicker' in window)) return onMessage?.('❌ File System Access no soportado');
    try {
      const [fileHandle] = await window.showOpenFilePicker({ multiple: false });
      const file = await fileHandle.getFile();
      setFsFileName(file.name);
      onMessage?.(`📁 Archivo seleccionado: "${file.name}" (${(file.size / 1024).toFixed(1)} KB)`);
    } catch (e) {
      if (e.name === 'AbortError') onMessage?.('⚠️ File System: cancelado por el usuario');
      else onMessage?.(`❌ File System: ${e.message}`);
    }
  };

  const testFileSave = async () => {
    if (!('showSaveFilePicker' in window)) return onMessage?.('❌ File System Access no soportado');
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `morelivery-export-${Date.now()}.json`,
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify({ exportedAt: new Date().toISOString(), test: true }, null, 2));
      await writable.close();
      onMessage?.(`💾 Archivo guardado: "${handle.name}"`);
    } catch (e) {
      if (e.name === 'AbortError') onMessage?.('⚠️ File System: cancelado por el usuario');
      else onMessage?.(`❌ File System: ${e.message}`);
    }
  };

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  useEffect(() => () => {
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    wakeLockRef.current?.release().catch(() => {});
    if (micAudioUrl) URL.revokeObjectURL(micAudioUrl);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render helpers ───────────────────────────────────────────────────────────
  const row = (label, content) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.25rem 0', borderBottom: '1px solid var(--border)', gap: '0.5rem', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{content}</span>
    </div>
  );

  const btnRow = (children) => (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.65rem' }}>
      {children}
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Btn onClick={refresh} disabled={loading}>{loading ? 'Actualizando…' : '↻ Refrescar todo'}</Btn>
      </div>

      {/* ── SSE ─────────────────────────────────────────────────────────────── */}
      <Card title="📡 SSE — Conexiones activas">
        {s.sseConnected === null
          ? <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Presiona Refrescar para obtener datos</span>
          : <>
              {row('Total conectados', <strong>{s.sseConnected}</strong>)}
              {Object.entries(s.sseByRole).length > 0
                ? Object.entries(s.sseByRole).map(([role, count]) => row(role, count))
                : row('Por rol', '—')}
            </>
        }
      </Card>

      {/* ── Service Worker ──────────────────────────────────────────────────── */}
      <Card title="⚙️ Service Worker">
        {row('Estado', <Badge state={s.sw === 'active' ? 'active' : s.sw === 'unsupported' ? 'unsupported' : 'unknown'} />)}
        {row('Valor exacto', s.sw)}
      </Card>

      {/* ── Notificaciones + Push ───────────────────────────────────────────── */}
      <Card title="🔔 Notificaciones y Push">
        {row('Permiso notificaciones', <Badge state={s.notifications === 'granted' ? 'granted' : s.notifications === 'denied' ? 'denied' : 'prompt'} />)}
        {row('Suscripción push', s.push === null ? '?' : s.push ? <Badge state="granted" /> : <Badge state="denied" />)}

        {btnRow(<>
          {s.notifications !== 'granted' && <Btn variant="warning" onClick={requestNotifications}>Solicitar permiso</Btn>}
          {s.notifications === 'granted' && <Btn onClick={fireTestNotif}>🔔 Notif. local</Btn>}
          {!s.push && s.notifications === 'granted' && <Btn variant="warning" onClick={requestPush}>Registrar push</Btn>}
          {s.push && <Btn variant="primary" onClick={testPush} disabled={pushSending}>{pushSending ? 'Enviando…' : '📨 Push de prueba'}</Btn>}
          {s.push && <Btn onClick={testVoiceReminders}>📳 Prueba push (30s + 5min)</Btn>}
        </>)}

        {s.notifications === 'granted' && (
          <div style={{ marginTop: '0.85rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 600 }}>
              Preview: acciones en notificación
            </div>
            <div style={{ background: 'var(--bg-app, #f5f5f5)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.65rem 0.8rem', fontSize: '0.82rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.15rem' }}>🛵 Nueva oferta de pedido</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginBottom: '0.55rem' }}>Restaurante Centro · $85.00 · 1.2 km</div>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {[['✅ Aceptar', '#22c55e'], ['❌ Rechazar', '#ef4444'], ['🗺 Ver ruta', 'var(--brand)']].map(([label, bg]) => (
                  <button key={label} onClick={() => { if (label.startsWith('✅')) fireTestNotif(); onMessage?.(`(${label} — sin acción real aún)`); }}
                    style={{ background: bg, color: '#fff', border: 'none', borderRadius: 7, padding: '0.3rem 0.8rem', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <Note>Las acciones reales en notificaciones del sistema requieren el campo <code>actions</code> en el SW — pendiente de implementar.</Note>
          </div>
        )}
      </Card>

      {/* ── Geolocalización ─────────────────────────────────────────────────── */}
      <Card title="📍 Geolocalización">
        {row('Permiso', <Badge state={s.geolocation} />)}
        {geoResult && <>
          {row('Latitud', geoResult.lat)}
          {row('Longitud', geoResult.lng)}
          {row('Precisión', `±${geoResult.accuracy}m`)}
        </>}
        {btnRow(<Btn onClick={requestGeo}>{s.geolocation === 'granted' ? '📍 Obtener posición actual' : 'Solicitar permiso + posición'}</Btn>)}
        <Note>
          <strong>Usos no triviales:</strong> geofence automático al llegar al restaurante/cliente (watchPosition + distancia),
          estimación de ETA dinámica, reducir frecuencia en 2G para ahorrar batería.
        </Note>
      </Card>

      {/* ── Almacenamiento persistente ──────────────────────────────────────── */}
      <Card title="💾 Almacenamiento persistente">
        {row('Estado', <Badge state={s.storage} />)}
        <Note>Evita que el SO elimine el caché del SW en segundo plano.</Note>
        {s.storage !== 'granted' && s.storage !== 'unsupported' && btnRow(
          <Btn variant="warning" onClick={requestStorage}>Solicitar persistencia</Btn>
        )}
      </Card>

      {/* ── Wake Lock ───────────────────────────────────────────────────────── */}
      <Card title="🔋 Wake Lock">
        {row('Soporte', <Badge state={s.wakeLock === 'unsupported' ? 'unsupported' : 'supported'} />)}
        {s.wakeLock !== 'unsupported' && row('Estado actual', <Badge state={s.wakeLock === 'active' ? 'active' : 'unknown'} />)}
        {s.wakeLock !== 'unsupported' && btnRow(
          <Btn variant={s.wakeLock === 'active' ? 'danger' : 'primary'} onClick={toggleWakeLock}>
            {s.wakeLock === 'active' ? '🔓 Liberar Wake Lock' : '🔒 Activar Wake Lock'}
          </Btn>
        )}
        <Note>
          <strong>Usos:</strong> mantener pantalla activa durante la entrega, modo mapa en moto.
          Combinar con batería baja para desactivarlo automáticamente bajo 15%.
        </Note>
      </Card>

      {/* ── Clipboard ───────────────────────────────────────────────────────── */}
      <Card title="📋 Clipboard">
        {row('Permiso', <Badge state={s.clipboard} />)}
        {clipResult && row('Último texto leído', <code style={{ fontSize: '0.75rem' }}>{clipResult}</code>)}
        {btnRow(<Btn onClick={testClipboard}>✏️ Probar escritura + lectura</Btn>)}
        <Note>
          <strong>Uso no trivial:</strong> tap en dirección de entrega → se copia automáticamente al portapapeles
          → repartidor la pega en Waze/Maps sin escribir nada.
        </Note>
      </Card>

      {/* ── Cámara ──────────────────────────────────────────────────────────── */}
      <Card title="📷 Cámara">
        {row('Permiso', <Badge state={s.camera} />)}
        {btnRow(
          <Btn variant={cameraOpen ? 'danger' : 'default'} onClick={toggleCamera}>
            {cameraOpen ? '⏹ Cerrar cámara' : '▶ Abrir cámara'}
          </Btn>
        )}
        <Note>
          <strong>Usos no triviales:</strong> foto obligatoria de entrega (sube al pedido para disputes),
          escaneo de QR/código de barras con zxing-js para confirmar pickup en restaurante.
        </Note>

        {cameraOpen && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <video ref={videoRef} autoPlay playsInline muted
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: capturedPhoto ? 'none' : 'block' }} />
              {capturedPhoto && <img src={capturedPhoto} alt="foto" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={toggleCamera} style={{ background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', borderRadius: '50%', width: 40, height: 40, fontSize: '1.1rem', cursor: 'pointer' }}>✕</button>
                {capturedPhoto && <button onClick={() => setCapturedPhoto(null)} style={{ background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', borderRadius: 20, padding: '0.3rem 0.8rem', fontSize: '0.85rem', cursor: 'pointer' }}>↩ Retomar</button>}
              </div>
            </div>
            <div style={{ padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#111' }}>
              <button onClick={toggleFlash} style={{ background: flashOn ? '#fbbf24' : 'rgba(255,255,255,0.15)', color: flashOn ? '#000' : '#fff', border: 'none', borderRadius: '50%', width: 48, height: 48, fontSize: '1.3rem', cursor: 'pointer' }}>⚡</button>
              {!capturedPhoto
                ? <button onClick={takePhoto} style={{ width: 70, height: 70, borderRadius: '50%', background: '#fff', border: '4px solid rgba(255,255,255,0.5)', cursor: 'pointer' }} />
                : <a href={capturedPhoto} download={`foto-${Date.now()}.jpg`} style={{ width: 70, height: 70, borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem', textDecoration: 'none' }}>⬇️</a>
              }
              <button onClick={flipCamera} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: '50%', width: 48, height: 48, fontSize: '1.3rem', cursor: 'pointer' }}>🔄</button>
            </div>
            <canvas ref={canvasRef} style={{ display: 'none' }} />
          </div>
        )}
      </Card>

      {/* ── 🎤 Micrófono ────────────────────────────────────────────────────── */}
      <Card title="🎤 Micrófono">
        {row('Permiso', <Badge state={s.microphone} />)}
        {row('Estado', micRecording ? <Badge state="active" /> : <Badge state={s.microphone === 'granted' ? 'supported' : s.microphone} />)}

        {btnRow(<>
          <Btn
            variant={micRecording ? 'danger' : s.microphone === 'denied' ? 'default' : 'primary'}
            onClick={toggleMic}
            disabled={s.microphone === 'denied'}
          >
            {micRecording ? '⏹ Detener grabación' : '🎙️ Grabar audio (prueba)'}
          </Btn>
          {micAudioUrl && (
            <a href={micAudioUrl} download={`audio-${Date.now()}.webm`}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 7, padding: '0.3rem 0.7rem', fontSize: '0.78rem', fontWeight: 600, textDecoration: 'none', color: 'var(--text-primary)' }}>
              ⬇️ Descargar
            </a>
          )}
        </>)}

        {micAudioUrl && (
          <div style={{ marginTop: '0.65rem' }}>
            <audio controls src={micAudioUrl} style={{ width: '100%', height: 36 }} />
          </div>
        )}

        <Note>
          <strong>Usos no triviales:</strong> confirmación de pedido por voz ("listo"/"rechazar") mientras el repartidor
          maneja — procesar con Whisper en el backend. Notas de entrega por voz adjuntas al historial del pedido.
          Requiere endpoint <code>POST /api/voice/transcribe</code>.
        </Note>
      </Card>

      {/* ── 📳 Vibración ────────────────────────────────────────────────────── */}
      <Card title="📳 Vibración">
        {row('Soporte', <Badge state={s.vibration} />)}

        {s.vibration === 'supported' && btnRow(<>
          <Btn onClick={() => testVibration([200], 'simple')}>· Simple</Btn>
          <Btn onClick={() => testVibration([200, 100, 200], 'doble')}>·· Doble</Btn>
          <Btn onClick={() => testVibration([300, 100, 300, 100, 300], 'urgente')}>··· Urgente</Btn>
          <Btn onClick={() => testVibration([100, 50, 100, 50, 100, 50, 600], 'nueva oferta')}>🛵 Nueva oferta</Btn>
          <Btn variant="danger" onClick={() => testVibration([800], 'alerta larga')}>🚨 Alerta</Btn>
        </>)}

        {s.vibration === 'unsupported' && <Note>No disponible en este navegador/dispositivo.</Note>}

        <Note>
          <strong>Usos no triviales:</strong> patrones diferenciados por evento — nueva oferta (corto·corto·largo),
          cancelación (largo continuo), confirmación de acción (pulse corto). El repartidor sabe qué pasó
          sin mirar la pantalla. Combinar con Push para vibración desde background.
        </Note>
      </Card>

      {/* ── 📶 Background Sync ──────────────────────────────────────────────── */}
      <Card title="📶 Background Sync">
        {row('Soporte', <Badge state={s.backgroundSync} />)}
        {row('Ítems en cola', <strong>{s.syncQueueLength}</strong>)}

        {s.backgroundSync === 'supported' && btnRow(<>
          <Btn variant="primary" onClick={testEnqueueSync}>+ Encolar petición de prueba</Btn>
          {s.syncQueueLength > 0 && <Btn variant="danger" onClick={clearSyncQueue}>🗑️ Vaciar cola</Btn>}
          <Btn onClick={async () => { const l = await readSyncQueueLength(); setS(p => ({ ...p, syncQueueLength: l })); onMessage?.(`Cola: ${l} ítem(s)`); }}>↻ Ver cola</Btn>
        </>)}

        <Note>
          <strong>Cómo funciona:</strong> cuando no hay red y el repartidor marca "Entregado", la app envía
          <code>ENQUEUE_REQUEST</code> al SW. Al recuperar señal, el SW reenvía automáticamente.
          El SW actual ya tiene la lógica implementada — solo falta el endpoint backend
          <code>POST /api/sync/test</code> (ver BACKEND_ENDPOINTS.md).
        </Note>
        <Note>
          <strong>Usos no triviales:</strong> marcar entregado offline, actualizar estado de pedido sin señal,
          envío de ubicación GPS encolado en zona muerta.
        </Note>
      </Card>

      {/* ── 🔵 Bluetooth ────────────────────────────────────────────────────── */}
      <Card title="🔵 Bluetooth (Web Bluetooth)">
        {row('Soporte', <Badge state={s.bluetooth} />)}
        {btDevice && <>
          {row('Dispositivo', btDevice.name)}
          {row('ID', <code style={{ fontSize: '0.72rem' }}>{btDevice.id?.slice(0, 16)}…</code>)}
        </>}

        {s.bluetooth === 'supported' && btnRow(
          <Btn variant="primary" onClick={requestBluetooth}>🔵 Escanear dispositivos</Btn>
        )}
        {s.bluetooth === 'unsupported' && <Note>Requiere Chrome/Edge en Android o Desktop. No disponible en Firefox ni Safari.</Note>}

        <Note>
          <strong>Usos no triviales:</strong> conectar impresora térmica Bluetooth para recibo de entrega,
          leer batería de scanner BLE del restaurante, sincronizar con smartwatch del repartidor para
          mostrar dirección en muñeca. Requiere que el dispositivo exponga servicios GATT estándar.
        </Note>
      </Card>

      {/* ── 📁 File System Access ───────────────────────────────────────────── */}
      <Card title="📁 File System Access">
        {row('Soporte', <Badge state={s.fileSystem} />)}
        {fsFileName && row('Último archivo', <code style={{ fontSize: '0.75rem' }}>{fsFileName}</code>)}

        {s.fileSystem === 'supported' && btnRow(<>
          <Btn variant="primary" onClick={testFileOpen}>📂 Abrir archivo</Btn>
          <Btn onClick={testFileSave}>💾 Guardar archivo JSON</Btn>
        </>)}
        {s.fileSystem === 'unsupported' && <Note>Requiere Chrome/Edge 86+. No disponible en Firefox ni Safari móvil.</Note>}

        <Note>
          <strong>Usos no triviales:</strong> exportar historial de pedidos del día a JSON/CSV directamente
          en el dispositivo del admin sin pasar por servidor, importar lista de restaurantes desde Excel
          local, guardar reporte de rutas como archivo nativo para compartir por WhatsApp.
        </Note>
      </Card>

      {/* ── Batería ─────────────────────────────────────────────────────────── */}
      <Card title="🔋 Batería">
        {s.battery === null
          ? row('Estado', 'No disponible en este navegador')
          : <>
              {row('Nivel', `${s.battery.level}%`)}
              {row('Cargando', s.battery.charging ? '✅ Sí' : 'No')}
              {!s.battery.charging && s.battery.dischargingTime !== Infinity && s.battery.dischargingTime > 0
                && row('Autonomía', `${Math.round(s.battery.dischargingTime / 60)} min`)}
            </>
        }
        <Note>
          <strong>Uso no trivial:</strong> si batería &lt; 20% → reducir frecuencia de GPS de 5s a 30s + liberar
          Wake Lock automáticamente + notificar al dispatcher antes de asignar pedido largo.
        </Note>
      </Card>

      {/* ── Red ─────────────────────────────────────────────────────────────── */}
      <Card title="🌐 Red">
        {s.network === null
          ? row('Estado', 'No disponible (API no soportada)')
          : <>
              {row('Tipo efectivo', s.network.effectiveType || '—')}
              {row('Velocidad bajada', s.network.downlink ? `${s.network.downlink} Mbps` : '—')}
              {row('RTT', s.network.rtt ? `${s.network.rtt} ms` : '—')}
              {row('Ahorro de datos', s.network.saveData ? '✅ Activado' : 'No')}
            </>
        }
        <Note>
          <strong>Uso no trivial:</strong> en 2G o saveData=true → desactivar mapa en tiempo real y fotos de alta resolución,
          aumentar intervalo de sync, mostrar alerta al dispatcher de que el repartidor tiene señal débil.
        </Note>
      </Card>

    </div>
  );
}

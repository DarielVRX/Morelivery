// frontend/src/features/admin/dashboard/tabs/useSystemTab.js
//
// Lógica de estado y acciones del SystemTab.
// Extraída para mantener el componente de render limpio y manejable.

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
  try {
    const p = await navigator.permissions.query({ name: 'geolocation' });
    return p.state;
  } catch { return 'unknown'; }
}

async function readNotifPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

async function readPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return Boolean(sub);
  } catch { return null; }
}

async function readSwState() {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg?.active?.state ?? 'inactive';
  } catch { return 'error'; }
}

async function readStoragePersisted() {
  if (!navigator.storage?.persisted) return 'unsupported';
  const p = await navigator.storage.persisted();
  return p ? 'granted' : 'default';
}

async function readClipboardPermission() {
  if (!navigator.clipboard) return 'unsupported';
  try {
    const p = await navigator.permissions.query({ name: 'clipboard-read' });
    return p.state;
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
  try {
    const p = await navigator.permissions.query({ name: 'microphone' });
    return p.state;
  } catch { return 'unknown'; }
}

function readVibrationSupport() {
  return 'vibrate' in navigator ? 'supported' : 'unsupported';
}

async function readBackgroundSyncSupport() {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  try {
    const reg = await navigator.serviceWorker.ready;
    return 'sync' in reg ? 'supported' : 'unsupported';
  } catch { return 'unsupported'; }
}

function readBluetoothSupport() {
  return 'bluetooth' in navigator ? 'supported' : 'unsupported';
}

function readFileSystemSupport() {
  return 'showOpenFilePicker' in window ? 'supported' : 'unsupported';
}

async function readSyncQueueLength() {
  try {
    const cache = await caches.open('morelivery-sync-queue');
    const resp = await cache.match('queue');
    if (!resp) return 0;
    const queue = await resp.json();
    return Array.isArray(queue) ? queue.length : 0;
  } catch { return 0; }
}

// ─── Estado inicial ────────────────────────────────────────────────────────────

const INITIAL_STATE = {
  sseConnected: null, sseByRole: {},
  sw: 'unknown', notifications: 'unknown', push: null,
  geolocation: 'unknown', storage: 'unknown', wakeLock: 'unknown',
  clipboard: 'unknown', battery: null, network: null, camera: 'unknown',
  microphone: 'unknown', vibration: 'unknown', backgroundSync: 'unknown',
  bluetooth: 'unknown', fileSystem: 'unknown', syncQueueLength: 0,
};

// ─── Hook principal ────────────────────────────────────────────────────────────

export function useSystemTab({ onMessage }) {
  const { auth } = useAuth();

  const videoRef         = useRef(null);
  const cameraStreamRef  = useRef(null);
  const micStreamRef     = useRef(null);
  const mediaRecorderRef = useRef(null);
  const wakeLockRef      = useRef(null);
  const canvasRef        = useRef(null);

  const [loading,       setLoading]       = useState(false);
  const [cameraOpen,    setCameraOpen]    = useState(false);
  const [cameraFacing,  setCameraFacing]  = useState('environment');
  const [flashOn,       setFlashOn]       = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const [geoResult,     setGeoResult]     = useState(null);
  const [clipResult,    setClipResult]    = useState(null);
  const [pushSending,   setPushSending]   = useState(false);
  const [micRecording,  setMicRecording]  = useState(false);
  const [micAudioUrl,   setMicAudioUrl]   = useState(null);
  const [fsFileName,    setFsFileName]    = useState(null);
  const [btDevice,      setBtDevice]      = useState(null);
  const [s, setS] = useState(INITIAL_STATE);

  // ── Refresh all ─────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [sw, notif, push, geo, storage, clip, battery, mic, bgSync, queueLen] = await Promise.all([
        readSwState(), readNotifPermission(), readPushSubscription(),
        readGeoPermission(), readStoragePersisted(), readClipboardPermission(),
        readBattery(), readMicPermission(), readBackgroundSyncSupport(), readSyncQueueLength(),
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
        wakeLock: wl, camera: cam, microphone: mic,
        vibration: readVibrationSupport(), backgroundSync: bgSync,
        bluetooth: readBluetoothSupport(), fileSystem: readFileSystemSupport(),
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

  // ── Notificaciones ───────────────────────────────────────────────────────────
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

  // ── Geo ──────────────────────────────────────────────────────────────────────
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

  // ── Storage / WakeLock / Clipboard ───────────────────────────────────────────
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
      onMessage?.(`✅ Clipboard OK — leído: "${read.slice(0, 20)}"`);
    } catch (e) { onMessage?.(`❌ Clipboard: ${e.message}`); }
  };

  // ── Cámara ───────────────────────────────────────────────────────────────────
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

  const toggleCamera = async () => {
    if (cameraOpen) {
      cameraStreamRef.current?.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
      setCameraOpen(false); setCapturedPhoto(null); setFlashOn(false);
    } else {
      await startCamera(cameraFacing);
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

  // ── Micrófono ────────────────────────────────────────────────────────────────
  const toggleMic = async () => {
    if (micRecording) { mediaRecorderRef.current?.stop(); return; }
    setMicAudioUrl(null);
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

  // ── Vibración ────────────────────────────────────────────────────────────────
  const testVibration = (pattern, label) => {
    if (!('vibrate' in navigator)) return onMessage?.('❌ Vibración no soportada');
    navigator.vibrate(pattern);
    onMessage?.(`📳 Patrón: ${label}`);
  };

  // ── Background Sync ──────────────────────────────────────────────────────────
  const testEnqueueSync = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      reg.active?.postMessage({
        type: 'ENQUEUE_REQUEST', url: '/api/sync/test', method: 'POST',
        body: JSON.stringify({ test: true, ts: Date.now() }), token: auth.token,
      });
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

  // ── Bluetooth ────────────────────────────────────────────────────────────────
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

  // ── File System ──────────────────────────────────────────────────────────────
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

  return {
    // Estado
    s, loading,
    cameraOpen, cameraFacing, flashOn, capturedPhoto,
    geoResult, clipResult, pushSending,
    micRecording, micAudioUrl,
    fsFileName, btDevice,
    // Refs para el render
    videoRef, canvasRef,
    // Acciones
    refresh,
    requestNotifications, fireTestNotif, testVoiceReminders,
    requestPush, testPush,
    requestGeo,
    requestStorage, toggleWakeLock,
    testClipboard,
    toggleCamera, flipCamera, toggleFlash, takePhoto,
    setCapturedPhoto,
    toggleMic,
    testVibration,
    testEnqueueSync, clearSyncQueue,
    requestBluetooth,
    testFileOpen, testFileSave,
  };
}

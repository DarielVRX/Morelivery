// frontend/src/features/admin/dashboard/tabs/SystemTab.jsx
//
// Panel de diagnóstico de APIs del navegador.
// Solo render — toda la lógica vive en useSystemTab.js.

import { useSystemTab } from './useSystemTab';

// ─── Componentes UI locales ────────────────────────────────────────────────────

function Badge({ state }) {
  const map = {
    granted: ['✅ Activo', '#16a34a'],
    active:  ['✅ Activo', '#16a34a'],
    prompt:  ['⚠️ Pendiente', '#d97706'],
    denied:  ['❌ Denegado', '#dc2626'],
    supported: ['✅ Soportado', '#16a34a'],
    unsupported: ['❌ No soportado', '#6b7280'],
  };
  const [label, color] = map[state] ?? ['— Desconocido', '#9ca3af'];
  return <span style={{ fontSize: '0.78rem', fontWeight: 700, color }}>{label}</span>;
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
  const colors = {
    default: 'var(--bg-app)', primary: 'var(--brand)', warning: '#d97706',
    danger: '#dc2626',
  };
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ background: colors[variant] || colors.default, color: variant === 'default' ? 'var(--text-primary)' : '#fff',
               border: '1px solid var(--border)', borderRadius: 7, padding: '0.3rem 0.75rem',
               fontSize: '0.78rem', fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
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

// ─── Render helpers ────────────────────────────────────────────────────────────

function row(label, content) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.25rem 0', borderBottom: '1px solid var(--border)', gap: '0.5rem', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{content}</span>
    </div>
  );
}

function btnRow(children) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.65rem' }}>
      {children}
    </div>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────────

export default function SystemTab({ onMessage }) {
  const {
    s, loading,
    cameraOpen, cameraFacing, flashOn, capturedPhoto,
    geoResult, clipResult, pushSending,
    micRecording, micAudioUrl,
    fsFileName, btDevice,
    videoRef, canvasRef,
    refresh,
    requestNotifications, fireTestNotif, testVoiceReminders,
    requestPush, testPush,
    requestGeo,
    requestStorage, toggleWakeLock,
    testClipboard,
    toggleCamera, flipCamera, toggleFlash, takePhoto, setCapturedPhoto,
    toggleMic,
    testVibration,
    testEnqueueSync, clearSyncQueue,
    requestBluetooth,
    testFileOpen, testFileSave,
  } = useSystemTab({ onMessage });

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
            <Note>Las acciones reales en notificaciones del sistema requieren el campo <code>actions</code> en el SW.</Note>
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
        <Note><strong>Usos no triviales:</strong> geofence automático al llegar al restaurante/cliente, estimación de ETA dinámica.</Note>
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
        <Note><strong>Usos:</strong> mantener pantalla activa durante la entrega, modo mapa en moto.</Note>
      </Card>

      {/* ── Clipboard ───────────────────────────────────────────────────────── */}
      <Card title="📋 Clipboard">
        {row('Permiso', <Badge state={s.clipboard} />)}
        {clipResult && row('Último texto leído', <code style={{ fontSize: '0.75rem' }}>{clipResult}</code>)}
        {btnRow(<Btn onClick={testClipboard}>✏️ Probar escritura + lectura</Btn>)}
        <Note><strong>Uso no trivial:</strong> tap en dirección de entrega → copia automáticamente al portapapeles del repartidor.</Note>
      </Card>

      {/* ── Cámara ──────────────────────────────────────────────────────────── */}
      <Card title="📷 Cámara">
        {row('Permiso', <Badge state={s.camera} />)}
        {btnRow(
          <Btn variant={cameraOpen ? 'danger' : 'default'} onClick={toggleCamera}>
            {cameraOpen ? '⏹ Cerrar cámara' : '▶ Abrir cámara'}
          </Btn>
        )}
        <Note><strong>Usos no triviales:</strong> foto obligatoria de entrega, escaneo de QR para confirmar pickup.</Note>

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
                : <button onClick={() => { const a = document.createElement('a'); a.href = capturedPhoto; a.download = `foto-${Date.now()}.jpg`; a.click(); }} style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: 10, padding: '0.5rem 1.2rem', fontWeight: 700, cursor: 'pointer' }}>⬇️ Guardar</button>
              }
              <button onClick={flipCamera} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: '50%', width: 48, height: 48, fontSize: '1.3rem', cursor: 'pointer' }}>🔄</button>
            </div>
          </div>
        )}
      </Card>

      {/* ── Micrófono ───────────────────────────────────────────────────────── */}
      <Card title="🎤 Micrófono">
        {row('Permiso', <Badge state={s.microphone} />)}
        {btnRow(
          <Btn variant={micRecording ? 'danger' : 'default'} onClick={toggleMic}>
            {micRecording ? '⏹ Detener grabación' : '🎙️ Grabar audio'}
          </Btn>
        )}
        {micAudioUrl && (
          <>
            {btnRow(
              <a href={micAudioUrl} download={`audio-${Date.now()}.webm`}
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 7, padding: '0.3rem 0.7rem', fontSize: '0.78rem', fontWeight: 600, textDecoration: 'none', color: 'var(--text-primary)' }}>
                ⬇️ Descargar
              </a>
            )}
            <div style={{ marginTop: '0.65rem' }}>
              <audio controls src={micAudioUrl} style={{ width: '100%', height: 36 }} />
            </div>
          </>
        )}
        <Note><strong>Usos no triviales:</strong> confirmación de pedido por voz, notas de entrega por voz. Requiere <code>POST /api/voice/transcribe</code>.</Note>
      </Card>

      {/* ── Vibración ───────────────────────────────────────────────────────── */}
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
        <Note><strong>Usos no triviales:</strong> patrones diferenciados por evento — el repartidor sabe qué pasó sin mirar la pantalla.</Note>
      </Card>

      {/* ── Background Sync ─────────────────────────────────────────────────── */}
      <Card title="📶 Background Sync">
        {row('Soporte', <Badge state={s.backgroundSync} />)}
        {row('Ítems en cola', <strong>{s.syncQueueLength}</strong>)}
        {s.backgroundSync === 'supported' && btnRow(<>
          <Btn variant="primary" onClick={testEnqueueSync}>+ Encolar petición de prueba</Btn>
          {s.syncQueueLength > 0 && <Btn variant="danger" onClick={clearSyncQueue}>🗑️ Vaciar cola</Btn>}
        </>)}
        <Note><strong>Cómo funciona:</strong> sin red, el SW encola peticiones y las reenvía al reconectar automáticamente.</Note>
      </Card>

      {/* ── Bluetooth ───────────────────────────────────────────────────────── */}
      <Card title="🔵 Bluetooth (Web Bluetooth)">
        {row('Soporte', <Badge state={s.bluetooth} />)}
        {btDevice && <>
          {row('Dispositivo', btDevice.name)}
          {row('ID', <code style={{ fontSize: '0.72rem' }}>{btDevice.id?.slice(0, 16)}…</code>)}
        </>}
        {s.bluetooth === 'supported' && btnRow(<Btn variant="primary" onClick={requestBluetooth}>🔵 Escanear dispositivos</Btn>)}
        {s.bluetooth === 'unsupported' && <Note>Requiere Chrome/Edge en Android o Desktop.</Note>}
        <Note><strong>Usos no triviales:</strong> impresora térmica BLE, smartwatch del repartidor.</Note>
      </Card>

      {/* ── File System ─────────────────────────────────────────────────────── */}
      <Card title="📁 File System Access">
        {row('Soporte', <Badge state={s.fileSystem} />)}
        {fsFileName && row('Último archivo', <code style={{ fontSize: '0.75rem' }}>{fsFileName}</code>)}
        {s.fileSystem === 'supported' && btnRow(<>
          <Btn variant="primary" onClick={testFileOpen}>📂 Abrir archivo</Btn>
          <Btn onClick={testFileSave}>💾 Guardar archivo JSON</Btn>
        </>)}
        {s.fileSystem === 'unsupported' && <Note>Requiere Chrome/Edge 86+.</Note>}
        <Note><strong>Usos no triviales:</strong> exportar historial de pedidos a JSON/CSV directamente en el dispositivo.</Note>
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
        <Note><strong>Uso no trivial:</strong> batería &lt; 20% → reducir GPS + liberar Wake Lock + notificar al dispatcher.</Note>
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
        <Note><strong>Uso no trivial:</strong> en 2G o saveData=true → desactivar mapa en tiempo real y fotos de alta resolución.</Note>
      </Card>

    </div>
  );
}

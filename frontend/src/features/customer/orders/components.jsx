import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../api/client';
import { useAuth } from '../../../contexts/AuthContext';
import { buildSuggestionDraft } from '../../orders/drafts';
import { IconCustomer, IconDriver, IconRestaurant } from '../../../App';


// ── Sonido suave para mensajes entrantes ─────────────────────────────────────
function playMessageSound() {
  if (typeof window === 'undefined') return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
    setTimeout(() => ctx.close().catch(() => {}), 400);
  } catch (_) {}
}

export function IconChat() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>; }
function IconSend() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>; }
export function IconChevronUp() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>; }
export function IconChevronDown() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>; }
export function IconStarFilled() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>; }
export function IconStarEmpty() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>; }

export function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }
export const STATUS_LABELS = {
  created: 'Recibido', assigned: 'Asignado', accepted: 'Aceptado', preparing: 'En preparación', ready: 'Listo para retiro', on_the_way: 'En camino', delivered: 'Entregado', cancelled: 'Cancelado', pending_driver: 'Buscando conductor',
};
export const HISTORY_PAGE = 20;

export function FeeBreakdown({ order }) {
  const sub = order.total_cents || 0;
  const svc = order.service_fee_cents || 0;
  const del_fee = order.delivery_fee_cents || 0;
  const tip = order.tip_cents || 0;
  const grandTotal = sub + svc + del_fee + tip;
  if (!svc && !del_fee && !tip) return null;
  return <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', borderTop: '1px solid var(--border-light)', paddingTop: '0.35rem', marginTop: '0.35rem' }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{fmt(sub)}</span></div><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tarifa de servicio</span><span>{fmt(svc)}</span></div><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tarifa de envío</span><span>{fmt(del_fee)}</span></div>{tip > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--success)' }}><span>Agradecimiento</span><span>+{fmt(tip)}</span></div>}<div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: 'var(--gray-700)', marginTop: '0.2rem' }}><span>Total</span><span>{fmt(grandTotal)}</span></div></div>;
}

function ensureLeafletCSS() {
  if (document.getElementById('leaflet-css')) return;
  const lnk = document.createElement('link');
  lnk.id = 'leaflet-css';
  lnk.rel = 'stylesheet';
  lnk.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(lnk);
}

export function DriverMap({ lat, lng, driverName }) {
  const ref = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    ensureLeafletCSS();
    const t = setTimeout(() => {
      import('leaflet').then(L => {
        if (!ref.current || mapRef.current) return;
        delete L.Icon.Default.prototype._getIconUrl;
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        });
        const map = L.map(ref.current, { zoomControl: false, attributionControl: false }).setView([lat, lng], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { keepBuffer: 1 }).addTo(map);
        const marker = L.circleMarker([lat, lng], { radius: 9, fillColor: '#2563eb', fillOpacity: 1, color: '#fff', weight: 2 }).addTo(map).bindPopup(driverName || 'Conductor');
        mapRef.current = { map, marker };
        setTimeout(() => map.invalidateSize(), 200);
      }).catch(() => {});
    }, 50);
    return () => {
      clearTimeout(t);
      if (mapRef.current?.map) { mapRef.current.map.remove(); mapRef.current = null; }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.marker?.setLatLng([lat, lng]);
    mapRef.current.map?.panTo([lat, lng], { animate: true, duration: 0.5 });
  }, [lat, lng]);

  return <div ref={ref} style={{ height: 180, borderRadius: 8, border: '1px solid var(--border)', marginTop: '0.5rem' }} />;
}

export function TipInput({ onValidAmount }) {
  const [val, setVal] = useState('');
  return <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}><input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="$ otro" value={val} onChange={e => { const raw = e.target.value.replace(/[^0-9]/g, ''); setVal(raw); const cents = Math.round(Number(raw) * 100); if (cents > 0) onValidAmount(cents); else if (raw === '') onValidAmount(0); }} style={{ width: 62, fontSize: '0.75rem', padding: '0.2rem 0.4rem', border: '1px solid var(--border)', borderRadius: 6 }} /></div>;
}

// ── Config por rol ─────────────────────────────────────────
const ROLE_CONFIG = {
  customer: {
    Icon: IconCustomer,
    color: 'var(--brand)',
    textColor: '#fff',
    align: 'flex-end',
    borderRadius: '10px 10px 2px 10px',
    label: 'Tú',
  },
  driver: {
    Icon: IconDriver,
    color: '#f59e0b',
    textColor: '#fff',
    align: 'flex-start',
    borderRadius: '10px 10px 10px 2px',
    label: 'Repartidor',
  },
  restaurant: {
    Icon: IconRestaurant,
    color: '#10b981',
    textColor: '#fff',
    align: 'flex-start',
    borderRadius: '10px 10px 10px 2px',
    label: 'Restaurante',
  },
};

// ── Burbuja de mensaje ─────────────────────────────────────
function MessageBubble({ m, isOwn }) {
  const cfg = ROLE_CONFIG[m.sender_role] || ROLE_CONFIG.customer;
  const { Icon } = cfg;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isOwn ? 'flex-end' : 'flex-start' }}>
    {!isOwn && (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem',
        marginBottom: '0.15rem', color: cfg.color, fontSize: '0.68rem', fontWeight: 700 }}>
        <Icon width={13} height={13} />
        {m.sender_name}
        </div>
    )}
    <div style={{
      background: cfg.color,
      color: cfg.textColor,
      borderRadius: isOwn ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
      padding: '0.3rem 0.6rem',
      fontSize: '0.8rem',
      maxWidth: '80%',
    }}>
    {m.text}
    </div>
    <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
    {new Date(m.created_at).toLocaleTimeString('es-MX', {
      timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit'
    })}
    </span>
    </div>
  );
}

// ── OrderChat ──────────────────────────────────────────────
export function OrderChat({ orderId, token, refreshTick }) {
  const [messages,     setMessages]     = useState([]);
  const [writeBlocked, setWriteBlocked] = useState(null); // null = puede escribir
  const [isAdminChat,  setIsAdminChat]  = useState(false);
  const [text,         setText]         = useState('');
  const [loading,      setLoading]      = useState(true);
  const [sending,      setSending]      = useState(false);
  const [reopening,      setReopening]      = useState(false);
  const bottomRef = useRef(null);
  const { auth } = useAuth();

  const myRole = auth.user?.role || 'customer';
  const myName = auth.user?.displayName || auth.user?.username || 'Tú';

  async function loadMessages() {
    try {
      const d = await apiFetch(`/orders/${orderId}/messages`, {}, token);
      setMessages(d.messages || []);
      setWriteBlocked(d.writeBlocked || null);
      setIsAdminChat(d.isAdmin || false);
    } catch (_) {}
    finally { setLoading(false); }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch(`/orders/${orderId}/messages`, {}, token)
      .then(d => {
        if (cancelled) return;
        setMessages(d.messages || []);
        setWriteBlocked(d.writeBlocked || null);
        setIsAdminChat(d.isAdmin || false);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orderId, token, refreshTick]);

  // Sonido al recibir mensaje ajeno
  const prevMsgCount = useRef(0);
  useEffect(() => {
    const incoming = messages.filter(m => m.sender_id !== auth.user?.id && !m.isSystem);
    if (incoming.length > prevMsgCount.current) playMessageSound();
    prevMsgCount.current = incoming.length;
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!text.trim() || sending || writeBlocked) return;
    setSending(true);
    const optimistic = {
      id:          Date.now(),
      sender_id:   auth.user?.id,
      sender_name: myName,
      sender_role: myRole,
      text:        text.trim(),
      created_at:  new Date().toISOString(),
      _own:        true, // siempre derecha, independiente del rol
    };
    setMessages(m => [...m, optimistic]);
    const sent = text.trim();
    setText('');
    try {
      await apiFetch(`/orders/${orderId}/messages`, { method: 'POST', body: JSON.stringify({ text: sent }) }, token);
      const d = await apiFetch(`/orders/${orderId}/messages`, {}, token);
      setMessages(d.messages || []);
      setWriteBlocked(d.writeBlocked || null);
    } catch {
      setMessages(m => m.filter(msg => msg.id !== optimistic.id));
      setText(sent);
    } finally { setSending(false); }
  }

  async function reopen() {
    setReopening(true);
    try {
      await apiFetch(`/orders/${orderId}/messages/reopen`, { method: 'POST' }, token);
      await loadMessages();
    } catch (_) {}
    finally { setReopening(false); }
  }

  // Countdown para el enfriamiento de 30s (COOLDOWN)
  const isCooldown = writeBlocked === 'COOLDOWN';
  const [cooldownSecs, setCooldownSecs] = useState(0);
  useEffect(() => {
    if (!isCooldown) { setCooldownSecs(0); return; }
    setCooldownSecs(30);
    const id = setInterval(() => {
      setCooldownSecs(s => {
        if (s <= 1) { clearInterval(id); loadMessages(); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isCooldown]);

  // ¿Puede este rol reabrir el chat?
  // customer: post-entrega dentro de ventana (excluye expirado)
  // driver: solo durante on_the_way
  const EXPIRED_MSG = 'La ventana de chat post-entrega expiró (30 min).';
  const canReopen = writeBlocked && writeBlocked !== EXPIRED_MSG
    && (myRole === 'customer' || myRole === 'driver');

  if (loading) return (
    <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', padding: '0.4rem 0' }}>
      Cargando mensajes…
    </div>
  );
  return (
    <div style={{ marginTop: '0.5rem', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>

      {/* Banner admin */}
      {isAdminChat && (
        <div style={{ padding: '0.35rem 0.65rem', background: '#fef3c7', borderBottom: '1px solid #fde68a',
          fontSize: '0.72rem', color: '#92400e', fontWeight: 600 }}>
          Estás escribiendo como Soporte — visible para todas las partes del pedido
        </div>
      )}


      {/* Lista de mensajes */}
      <div style={{ maxHeight: 180, overflowY: 'auto', padding: '0.6rem 0.65rem',
        display: 'flex', flexDirection: 'column', gap: '0.5rem',
        background: 'var(--bg-sunken)' }}>
        {messages.length === 0 && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', textAlign: 'center' }}>
            Sin mensajes aún
          </span>
        )}
        {messages.map(m => (
          m.isSystem
            ? (
              <div key={m.id} style={{ textAlign: 'center', fontSize: '0.68rem',
                color: 'var(--text-tertiary)', fontStyle: 'italic', padding: '0.1rem 0' }}>
                {m.text}
              </div>
            )
            : (
              <MessageBubble
                key={m.id}
                m={m}
                isOwn={m._own === true || m.sender_id === auth.user?.id}
              />
            )
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input o estado bloqueado */}
      {writeBlocked ? (
        <div style={{ padding: '0.5rem 0.65rem', background: 'var(--bg-raised)',
          borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center',
          gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, fontSize: '0.72rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
            {isCooldown
              ? `Podrás reintegrar el chat en ${cooldownSecs}s…`
              : writeBlocked}
          </span>
          {canReopen && (
            <button
              onClick={reopen}
              disabled={reopening || isCooldown}
              style={{ padding: '0.2rem 0.65rem', fontSize: '0.72rem', fontWeight: 700,
                border: '1px solid var(--brand)', borderRadius: 6, cursor: isCooldown ? 'default' : 'pointer',
                background: 'var(--brand-light)', color: 'var(--brand)',
                opacity: (reopening || isCooldown) ? 0.45 : 1 }}>
              {reopening ? '…' : isCooldown ? `${cooldownSecs}s` : '↩ Reintegrar al chat'}
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', borderTop: '1px solid var(--border)', background: 'var(--bg-card)' }}>
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Escribe un mensaje…"
            style={{ flex: 1, border: 'none', outline: 'none',
              padding: '0.45rem 0.65rem', fontSize: '0.8rem', background: 'none' }}
          />
          <button
            onClick={send}
            disabled={!text.trim() || sending}
            style={{ background: 'var(--brand)', color: '#fff', border: 'none',
              padding: '0 0.75rem', cursor: 'pointer', fontSize: '0.8rem',
              fontWeight: 700, opacity: text.trim() ? 1 : 0.45 }}>
            {sending ? '…' : <IconSend />}
          </button>
        </div>
      )}
    </div>
  );
}


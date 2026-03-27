// frontend/src/features/support/SupportChat.jsx
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

function IconSend() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
}
function IconBack() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>;
}
function IconPlus() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
}
function IconSupport() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
}

const STATUS_LABEL = {
  open:     { label: 'Abierto',   color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe' },
  pending:  { label: 'Pendiente', color: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
  resolved: { label: 'Resuelto',  color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  closed:   { label: 'Cerrado',   color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
};

function SupportBubble({ m, isOwn }) {
  if (m.is_system) {
    return (
      <div style={{ textAlign: 'center', fontSize: '0.68rem',
        color: 'var(--text-tertiary)', fontStyle: 'italic', padding: '0.15rem 0' }}>
        {m.text}
      </div>
    );
  }
  const isAdmin       = m.sender_role === 'admin';
  const bubbleColor   = isOwn ? 'var(--brand)' : isAdmin ? '#1e293b' : '#e2e8f0';
  const textColor     = isOwn || isAdmin ? '#fff' : 'var(--text-primary)';
  const borderRadius  = isOwn ? '10px 10px 2px 10px' : '10px 10px 10px 2px';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isOwn ? 'flex-end' : 'flex-start' }}>
      {!isOwn && (
        <div style={{ fontSize: '0.68rem', fontWeight: 700,
          color: isAdmin ? '#1e293b' : 'var(--text-secondary)',
          marginBottom: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          {isAdmin && <IconSupport />}
          {isAdmin ? 'Soporte' : m.sender_name}
        </div>
      )}
      <div style={{ background: bubbleColor, color: textColor,
        borderRadius, padding: '0.35rem 0.65rem',
        fontSize: '0.8rem', maxWidth: '82%', lineHeight: 1.4 }}>
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

function TicketChat({ ticketId, onBack, refreshTick }) {
  const { auth } = useAuth();
  const [ticket,   setTicket]   = useState(null);
  const [messages, setMessages] = useState([]);
  const [text,     setText]     = useState('');
  const [loading,  setLoading]  = useState(true);
  const [sending,  setSending]  = useState(false);
  const [closing,  setClosing]  = useState(false);
  const bottomRef = useRef(null);
  const isAdmin = auth.user?.role === 'admin';

  async function load() {
    try {
      const d = await apiFetch(`/support/tickets/${ticketId}/messages`, {}, auth.token);
      setTicket(d.ticket);
      setMessages(d.messages || []);
    } catch (_) {}
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [ticketId, refreshTick]); // eslint-disable-line
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    const optimistic = {
      id: Date.now(), sender_id: auth.user?.id,
      sender_name: auth.user?.alias || auth.user?.username,
      sender_role: auth.user?.role,
      text: text.trim(), created_at: new Date().toISOString(),
      _own: true,
    };
    setMessages(m => [...m, optimistic]);
    const sent = text.trim();
    setText('');
    try {
      await apiFetch(`/support/tickets/${ticketId}/messages`,
        { method: 'POST', body: JSON.stringify({ text: sent }) }, auth.token);
      await load();
    } catch {
      setMessages(m => m.filter(msg => msg.id !== optimistic.id));
      setText(sent);
    } finally { setSending(false); }
  }

  async function closeTicket() {
    setClosing(true);
    try {
      await apiFetch(`/support/tickets/${ticketId}/status`,
        { method: 'PATCH', body: JSON.stringify({ status: 'closed' }) }, auth.token);
      await load();
    } catch (_) {}
    finally { setClosing(false); }
  }

  async function resolveTicket() {
    setClosing(true);
    try {
      await apiFetch(`/support/tickets/${ticketId}/status`,
        { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) }, auth.token);
      await load();
    } catch (_) {}
    finally { setClosing(false); }
  }

  const isClosed = ticket && ['resolved', 'closed'].includes(ticket.status);
  const st = ticket ? STATUS_LABEL[ticket.status] : null;

  if (loading) return (
    <div style={{ padding: '1rem', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>Cargando…</div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
        padding: '0.65rem 1rem', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-card)', flexShrink: 0 }}>
        <button onClick={onBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-secondary)', display: 'flex', padding: '0.2rem' }}>
          <IconBack />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.88rem',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ticket?.subject}
          </div>
          {st && (
            <span style={{ fontSize: '0.68rem', fontWeight: 700,
              color: st.color, background: st.bg, border: `1px solid ${st.border}`,
              borderRadius: 6, padding: '1px 6px' }}>
              {st.label}
            </span>
          )}
        </div>
        {!isClosed && (
          isAdmin ? (
            <button onClick={resolveTicket} disabled={closing}
              style={{ padding: '0.2rem 0.6rem', fontSize: '0.72rem', fontWeight: 700,
                border: '1px solid var(--success-border)', borderRadius: 6,
                background: 'var(--success-bg)', color: '#16a34a', cursor: 'pointer',
                opacity: closing ? 0.6 : 1 }}>
              {closing ? '…' : 'Resolver'}
            </button>
          ) : (
            <button onClick={closeTicket} disabled={closing}
              style={{ padding: '0.2rem 0.6rem', fontSize: '0.72rem', fontWeight: 700,
                border: '1px solid var(--border)', borderRadius: 6,
                background: 'var(--bg-raised)', color: 'var(--text-secondary)',
                cursor: 'pointer', opacity: closing ? 0.6 : 1 }}>
              {closing ? '…' : 'Cerrar'}
            </button>
          )
        )}
      </div>

      {isAdmin && (
        <div style={{ padding: '0.3rem 1rem', background: '#fef3c7',
          borderBottom: '1px solid #fde68a', fontSize: '0.72rem',
          color: '#92400e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <IconSupport /> Estás respondiendo como Soporte — visible para el usuario
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1rem',
        display: 'flex', flexDirection: 'column', gap: '0.5rem',
        background: 'var(--bg-sunken)' }}>
        {messages.map(m => (
          <SupportBubble key={m.id} m={m} isOwn={m._own === true || m.sender_id === auth.user?.id} />
        ))}
        <div ref={bottomRef} />
      </div>

      {isClosed ? (
        <div style={{ padding: '0.65rem 1rem', background: 'var(--bg-raised)',
          borderTop: '1px solid var(--border)', fontSize: '0.78rem',
          color: 'var(--text-tertiary)', textAlign: 'center', fontStyle: 'italic' }}>
          {ticket.status === 'resolved' ? 'Ticket resuelto' : 'Ticket cerrado'}
        </div>
      ) : (
        <div style={{ display: 'flex', borderTop: '1px solid var(--border)',
          background: 'var(--bg-card)', flexShrink: 0 }}>
          <input value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Escribe un mensaje…"
            style={{ flex: 1, border: 'none', outline: 'none',
              padding: '0.5rem 0.75rem', fontSize: '0.82rem', background: 'none' }} />
          <button onClick={send} disabled={!text.trim() || sending}
            style={{ background: 'var(--brand)', color: '#fff', border: 'none',
              padding: '0 0.875rem', cursor: 'pointer',
              opacity: text.trim() ? 1 : 0.45 }}>
            {sending ? '…' : <IconSend />}
          </button>
        </div>
      )}
    </div>
  );
}

function TicketList({ onSelect, onNew }) {
  const { auth } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const isAdmin = auth.user?.role === 'admin';

  useEffect(() => {
    apiFetch('/support/tickets', {}, auth.token)
      .then(d => setTickets(d.tickets || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line

  if (loading) return (
    <div style={{ padding: '1rem', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>Cargando…</div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-card)', display: 'flex',
        justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>
            {isAdmin ? 'Soporte' : 'Mis consultas'}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
            {isAdmin
              ? `${tickets.length} ticket${tickets.length !== 1 ? 's' : ''} abiertos`
              : 'Escríbenos si tienes algún problema'}
          </div>
        </div>
        {!isAdmin && (
          <button onClick={onNew}
            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem',
              padding: '0.35rem 0.75rem', background: 'var(--brand)', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer',
              fontSize: '0.78rem', fontWeight: 700 }}>
            <IconPlus /> Nueva consulta
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
        {tickets.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center',
            color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
            {isAdmin ? 'Sin tickets abiertos' : 'No tienes consultas aún'}
          </div>
        ) : (
          tickets.map(t => {
            const st = STATUS_LABEL[t.status] || STATUS_LABEL.open;
            return (
              <div key={t.id} onClick={() => onSelect(t.id)}
                style={{ padding: '0.75rem', marginBottom: '0.4rem',
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 8, cursor: 'pointer', borderLeft: `3px solid ${st.color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'flex-start', gap: '0.5rem' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isAdmin && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginBottom: '0.15rem' }}>
                        {t.user_name} · {t.user_role}
                      </div>
                    )}
                    <div style={{ fontWeight: 600, fontSize: '0.85rem',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.subject}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '0.2rem' }}>
                      {new Date(t.updated_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                      {t.message_count > 0 && ` · ${t.message_count} mensaje${t.message_count !== 1 ? 's' : ''}`}
                    </div>
                  </div>
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, flexShrink: 0,
                    color: st.color, background: st.bg, border: `1px solid ${st.border}`,
                    borderRadius: 6, padding: '1px 6px' }}>
                    {st.label}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function NewTicketForm({ onBack, onCreate }) {
  const { auth } = useAuth();
  const [subject, setSubject] = useState('');
  const [text,    setText]    = useState('');
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState('');

  async function submit() {
    if (!subject.trim() || !text.trim()) { setErr('Completa el asunto y el mensaje'); return; }
    setSaving(true);
    try {
      const d = await apiFetch('/support/tickets',
        { method: 'POST', body: JSON.stringify({ subject: subject.trim(), text: text.trim() }) },
        auth.token);
      onCreate(d.ticket.id);
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
        padding: '0.65rem 1rem', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-card)', flexShrink: 0 }}>
        <button onClick={onBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-secondary)', display: 'flex', padding: '0.2rem' }}>
          <IconBack />
        </button>
        <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Nueva consulta</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem',
        display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
        <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>
          Asunto
          <input value={subject} onChange={e => setSubject(e.target.value)}
            placeholder="Ej: Problema con mi pedido"
            style={{ display: 'block', width: '100%', marginTop: '0.3rem', boxSizing: 'border-box' }} />
        </label>
        <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>
          Describe tu problema
          <textarea value={text} onChange={e => setText(e.target.value)}
            placeholder="Cuéntanos con detalle qué ocurrió…" rows={5}
            style={{ display: 'block', width: '100%', marginTop: '0.3rem',
              fontSize: '0.82rem', resize: 'vertical', boxSizing: 'border-box' }} />
        </label>
        {err && <div style={{ fontSize: '0.78rem', color: 'var(--danger)', fontWeight: 600 }}>{err}</div>}
        <button onClick={submit} disabled={saving || !subject.trim() || !text.trim()}
          className="btn-primary"
          style={{ opacity: (!subject.trim() || !text.trim()) ? 0.5 : 1 }}>
          {saving ? 'Enviando…' : 'Enviar consulta'}
        </button>
      </div>
    </div>
  );
}

export default function SupportChat({ refreshTick }) {
  const [view,     setView]     = useState('list');
  const [activeId, setActiveId] = useState(null);

  function openTicket(id) { setActiveId(id); setView('chat'); }
  function goList()       { setActiveId(null); setView('list'); }
  function goNew()        { setView('new'); }
  function onCreate(id)   { openTicket(id); }

  if (view === 'chat' && activeId) return <TicketChat ticketId={activeId} onBack={goList} refreshTick={refreshTick} />;
  if (view === 'new')              return <NewTicketForm onBack={goList} onCreate={onCreate} />;
  return <TicketList onSelect={openTicket} onNew={goNew} />;
}

import { useEffect, useRef, useState } from 'react';
import { nominatimReverse } from '../../../utils/geocode';

export function IconPin() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>; }
export function IconMap() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>; }
export function IconSearch() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>; }
export function IconWarning() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>; }
export function IconStore() { return <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>; }
export function IconStoreXL() { return <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>; }

export function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371; const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1); const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(a));
}
export function fmt(cents) { return `$${((cents ?? 0) / 100).toFixed(2)}`; }

export function ProductImage({ src, name }) {
    const [err, setErr] = useState(false);
    if (!src || err) return <div className="product-img-placeholder"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M7 14c0-2.8 2.2-5 5-5s5 2.2 5 5"/><path d="M9 9h.01M15 9h.01"/></svg></div>;
    return <img src={src} alt={name} onError={() => setErr(true)} className="product-img" />;
}

export function StarPicker({ value, onChange, label }) {
    return <div style={{ marginBottom: '0.5rem' }}><div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>{label}</div><div style={{ display: 'flex', gap: '4px' }}>{[1, 2, 3, 4, 5].map(s => <button key={s} onClick={() => onChange(s)} style={{ fontSize: '1.4rem', background: 'none', border: 'none', cursor: 'pointer', color: s <= value ? '#f59e0b' : 'var(--border)', padding: 0, minHeight: 'unset', lineHeight: 1 }}>★</button>)}</div></div>;
}

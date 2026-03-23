// frontend/src/components/ZonePlacer.jsx
//
// Flujo en 3 pasos:
//   step 'place' — círculo CSS + Confirmar área / Cancelar
//   step 'type'  — grid de tipos (6 chips)
//   step 'hours' — grid de vigencias → llama onConfirm
//
// Al confirmar el área:
//   1. Se captura lat/lng/radius_m al instante
//   2. Se bloquea el mapa (dragPan, scrollZoom, touchZoomRotate desactivados)
//   3. Se coloca un marcador MapLibre fijo en las coordenadas capturadas
//   4. El círculo CSS se oculta — el marcador es la referencia visual inamovible

import { useEffect, useRef, useState } from 'react';

// Píxeles de radio del círculo CSS en pantalla
const CIRCLE_PX = 110;

// Metros por píxel CSS (no físico) a un zoom y latitud dados.
// MapLibre usa 512px de tile size internamente — el factor correcto es:
//   (earth_circumference / tile_size) * cos(lat) / 2^zoom
// dividido por devicePixelRatio para pasar de px físicos a px CSS.
function metersPerCssPx(lat, zoom) {
  const dpr  = window.devicePixelRatio || 1;
  const base = (2 * Math.PI * 6378137 * Math.cos((lat * Math.PI) / 180)) / (512 * Math.pow(2, zoom));
  return base * dpr;
}

const ZONE_TYPES = [
  { value: "traffic",      emoji: "🚦", label: "Tráfico pesado",       color: "#f97316" },
  { value: "construction", emoji: "🚧", label: "Obra en construcción", color: "#eab308" },
  { value: "accident",     emoji: "🚨", label: "Accidente",            color: "#ef4444" },
  { value: "flood",        emoji: "🌊", label: "Inundación",           color: "#3b82f6" },
  { value: "blocked",      emoji: "⛔", label: "Calle bloqueada",      color: "#8b5cf6" },
  { value: "other",        emoji: "⚠️", label: "Otro problema",        color: "#6b7280" },
];

const HOURS_OPTS = [
  { value: 1,  label: "~1 hora"  },
  { value: 2,  label: "~2 horas" },
  { value: 4,  label: "~4 horas" },
  { value: 8,  label: "Medio día" },
  { value: 12, label: "12 horas" },
  { value: 24, label: "1 día"    },
  { value: 48, label: "2 días"   },
  { value: 72, label: "3 días"   },
];

export default function ZonePlacer({ map, onConfirm, onCancel, bottomOffset = 0 }) {
  const [step,      setStep]      = useState("place"); // "place" | "type" | "hours"
  const [radiusM,   setRadiusM]   = useState(100);
  const [zoneType,  setZoneType]  = useState(null);
  const [newHours,  setNewHours]  = useState(1);
  const [captured,  setCaptured]  = useState(null);   // {lat,lng,radius_m}
  const [saving,    setSaving]    = useState(false);
  const markerRef   = useRef(null);
  const mlRef       = useRef(null); // referencia a maplibre-gl

  // Derivados — antes de cualquier useEffect
  const sel         = ZONE_TYPES.find(t => t.value === zoneType) || null;
  const circleColor = sel ? sel.color : "#e3aaaa";

  // Obtener referencia a MapLibre una vez
  useEffect(() => {
    // DriverMap expone window.__map; la lib ya está cargada en ese punto
    const tryGet = () => {
      if (window.__maplibregl) { mlRef.current = window.__maplibregl; return true; }
      // Intentar extraer la clase desde el mapa mismo
      if (map && map.constructor) {
        // MapLibre expone Marker en el mismo bundle — buscamos en window
        const keys = Object.keys(window).filter(k => window[k]?.Marker && window[k]?.Map);
        if (keys.length) { mlRef.current = window[keys[0]]; return true; }
      }
      return false;
    };
    if (!tryGet()) {
      const t = setTimeout(tryGet, 300);
      return () => clearTimeout(t);
    }
  }, [map]);

  // Radio en tiempo real — SOLO en step 'place'
  useEffect(() => {
    if (!map || step !== "place") return;
    function refresh() {
      const c    = map.getCenter();
      const zoom = map.getZoom();
      setRadiusM(Math.max(20, Math.min(2000, Math.round(CIRCLE_PX * metersPerCssPx(c.lat, zoom)))));
    }
    refresh();
    map.on("move", refresh);
    map.on("zoom", refresh);
    return () => { map.off("move", refresh); map.off("zoom", refresh); };
  }, [map, step]);

  // Colocar marcador fijo cuando se captura el área
  useEffect(() => {
    if (!map || !captured) return;
    // Limpiar marcador previo
    if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }

    const ml = mlRef.current;
    if (!ml?.Marker) return;

    // Calcular tamaño del marcador en px CSS equivalente al radio capturado
    // Para que sea visualmente fiel usamos el zoom en el momento de captura
    const zoom = map.getZoom();
    const pxRadius = Math.round(captured.radius_m / metersPerCssPx(captured.lat, zoom));
    const sizePx   = pxRadius * 2;

    const el = document.createElement("div");
    el.style.cssText = [
      `width:${sizePx}px`, `height:${sizePx}px`, "border-radius:50%",
      `border:2.5px solid ${circleColor}`,
      `background:${circleColor}1a`,
      `box-shadow:0 0 0 3px ${circleColor}33`,
      "pointer-events:none",
    ].join(";");

    markerRef.current = new ml.Marker({ element: el, anchor: "center" })
      .setLngLat([captured.lng, captured.lat])
      .addTo(map);

    return () => { if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; } };
  }, [captured, map, circleColor]);

  function handleStep1() {
    if (!map) return;
    const c    = map.getCenter();
    const zoom = map.getZoom();
    const r    = Math.max(20, Math.min(2000, Math.round(CIRCLE_PX * metersPerCssPx(c.lat, zoom))));

    // Bloquear interacción del mapa para que el área quede inamovible
    map.dragPan.disable();
    map.scrollZoom.disable();
    map.touchZoomRotate.disable();
    map.doubleClickZoom.disable();

    setCaptured({ lat: c.lat, lng: c.lng, radius_m: r });
    setStep("type");
  }

  function handleTypeSelect(val) {
    setZoneType(val);
    setStep("hours");
  }

  function handleConfirm() {
    if (!captured || saving) return;
    setSaving(true);
    // Re-habilitar mapa antes de salir
    map.dragPan.enable();
    map.scrollZoom.enable();
    map.touchZoomRotate.enable();
    map.doubleClickZoom.enable();
    onConfirm({ ...captured, type: zoneType, estimated_hours: newHours });
  }

  function handleCancel() {
    // Re-habilitar mapa
    if (map) {
      map.dragPan.enable();
      map.scrollZoom.enable();
      map.touchZoomRotate.enable();
      map.doubleClickZoom.enable();
    }
    onCancel();
  }

  function handleBack() {
    setStep("type");
  }

  const displayR = radiusM >= 1000
    ? `${(radiusM / 1000).toFixed(1)} km`
    : `${radiusM} m`;

  const panelBase = {
    position: "absolute", bottom: bottomOffset, left: 0, right: 0,
    pointerEvents: "auto",
    background: "#fff",
    borderTop: `3px solid ${circleColor}`,
    padding: `0.75rem 1rem calc(0.8rem + env(safe-area-inset-bottom,0px))`,
    boxShadow: "0 -4px 24px rgba(0,0,0,0.14)",
    transition: "border-top-color 0.25s",
  };

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 20,
      pointerEvents: "none",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
    }}>

      {/* ── Círculo CSS — solo visible en step place ─────────────────── */}
      {step === "place" && (
        <>
          <div style={{
            width: CIRCLE_PX * 2, height: CIRCLE_PX * 2, borderRadius: "50%",
            border: `2.5px solid ${circleColor}`,
            background: circleColor + "1a",
            boxShadow: `0 0 0 3px ${circleColor}33`,
            position: "relative", flexShrink: 0,
            transition: "border-color 0.25s, background 0.25s",
          }}>
            <div style={{ position:"absolute", top:"50%", left:"50%", width:1, height:20, background:circleColor, transform:"translate(-50%,-50%)" }} />
            <div style={{ position:"absolute", top:"50%", left:"50%", width:20, height:1, background:circleColor, transform:"translate(-50%,-50%)" }} />
            <div style={{ position:"absolute", top:"50%", left:"50%", width:6, height:6, borderRadius:"50%", background:circleColor, transform:"translate(-50%,-50%)" }} />
          </div>
          <div style={{
            marginTop: 8, pointerEvents: "none",
            background: "rgba(0,0,0,0.58)", color: "#fff",
            borderRadius: 10, padding: "0.18rem 0.6rem",
            fontSize: "0.7rem", fontWeight: 600,
          }}>
            {displayR} · mueve y ajusta el zoom
          </div>
        </>
      )}

      {/* ══ STEP 1 — Confirmar / Cancelar ════════════════════════════════ */}
      {step === "place" && (
        <div style={panelBase}>
          <p style={{ margin: "0 0 0.55rem", fontSize: "0.78rem", color: "#6b7280", textAlign: "center" }}>
            Zona de alerta · ajusta el área sobre el mapa
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={handleStep1} style={{
              flex: 1, padding: "0.68rem 0", borderRadius: 10, fontSize: "0.9rem",
              fontWeight: 700, cursor: "pointer", border: "none",
              background: "#e3aaaa", color: "#fff",
              boxShadow: "0 2px 8px rgba(227,170,170,0.45)",
            }}>
              Confirmar área →
            </button>
            <button onClick={handleCancel} style={{
              flex: 1, padding: "0.68rem 0", borderRadius: 10, fontSize: "0.9rem",
              fontWeight: 600, cursor: "pointer",
              background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb",
            }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ══ STEP 2 — Tipo de problema ════════════════════════════════════ */}
      {step === "type" && (
        <div style={panelBase}>
          <p style={{ margin: "0 0 0.6rem", fontWeight: 700, fontSize: "0.88rem" }}>
            ¿Qué tipo de problema?
          </p>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
            gap: "0.45rem", marginBottom: "0.6rem",
          }}>
            {ZONE_TYPES.map(t => (
              <button key={t.value} onClick={() => handleTypeSelect(t.value)} style={{
                padding: "0.65rem 0.2rem", borderRadius: 10, cursor: "pointer",
                background: t.color + "14", border: `2px solid ${t.color}`,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
              }}>
                <span style={{ fontSize: "1.5rem", lineHeight: 1 }}>{t.emoji}</span>
                <span style={{ fontSize: "0.65rem", fontWeight: 700, color: t.color, textAlign: "center", lineHeight: 1.2 }}>
                  {t.label}
                </span>
              </button>
            ))}
          </div>
          <button onClick={handleCancel} style={{
            width: "100%", padding: "0.5rem 0", borderRadius: 8, fontSize: "0.8rem",
            fontWeight: 600, cursor: "pointer",
            background: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb",
          }}>✕ Cancelar</button>
        </div>
      )}

      {/* ══ STEP 3 — Duración ════════════════════════════════════════════ */}
      {step === "hours" && (
        <div style={panelBase}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.65rem" }}>
            {sel && <span style={{ fontSize: "1.3rem" }}>{sel.emoji}</span>}
            <span style={{ fontWeight: 700, fontSize: "0.88rem", color: circleColor }}>
              {sel?.label}
            </span>
            <span style={{ fontSize: "0.72rem", color: "#9ca3af", marginLeft: "auto" }}>
              ¿Cuánto durará?
            </span>
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr",
            gap: "0.38rem", marginBottom: "0.6rem",
          }}>
            {HOURS_OPTS.map(o => (
              <button key={o.value} onClick={() => setNewHours(o.value)} style={{
                padding: "0.55rem 0.2rem", borderRadius: 9, cursor: "pointer",
                background: newHours === o.value ? circleColor + "18" : "#f9fafb",
                border: `1.5px solid ${newHours === o.value ? circleColor : "#e5e7eb"}`,
                fontSize: "0.8rem",
                fontWeight: newHours === o.value ? 700 : 400,
                color: newHours === o.value ? circleColor : "#374151",
              }}>{o.label}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button onClick={handleConfirm} disabled={saving} style={{
              flex: 1, padding: "0.6rem", borderRadius: 9,
              cursor: saving ? "wait" : "pointer",
              background: circleColor, color: "#fff", border: "none",
              fontSize: "0.85rem", fontWeight: 700, opacity: saving ? 0.7 : 1,
            }}>{saving ? "Enviando…" : "Reportar zona"}</button>
            <button onClick={handleBack} style={{
              flex: 1, padding: "0.6rem", borderRadius: 9, cursor: "pointer",
              background: "#f3f4f6", border: "1px solid #e5e7eb",
              fontSize: "0.8rem", color: "#6b7280", fontWeight: 600,
            }}>← Tipo</button>
          </div>
        </div>
      )}

    </div>
  );
}

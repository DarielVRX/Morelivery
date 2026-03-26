-- Migration: Pack 3 — impassable_reports grouping + geometry
-- Ejecutar una sola vez en producción

-- 1. Agregar name para mostrar en UI (ej. "Av. Revolución")
ALTER TABLE impassable_reports
  ADD COLUMN IF NOT EXISTS name TEXT;

-- 2. Agregar coords JSONB para dibujar el tramo en el mapa
--    Formato: [[lng, lat], [lng, lat], ...]
ALTER TABLE impassable_reports
  ADD COLUMN IF NOT EXISTS coords JSONB;

-- 3. Agregar way_ids TEXT[] para agrupar múltiples segmentos OSM en un solo reporte
--    El way_id principal sigue siendo el campo way_id (primer segmento o el más representativo)
ALTER TABLE impassable_reports
  ADD COLUMN IF NOT EXISTS way_ids TEXT[];

-- 4. Índice para búsqueda por nombre (útil para deduplicar por calle)
CREATE INDEX IF NOT EXISTS idx_impassable_name ON impassable_reports(name) WHERE name IS NOT NULL;

ALTER TABLE impassable_reports ADD COLUMN IF NOT EXISTS way_ids TEXT[];

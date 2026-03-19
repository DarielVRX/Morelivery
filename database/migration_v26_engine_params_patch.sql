-- migration_v26_engine_params_patch.sql
-- Añade los parámetros del motor que faltaban en la migración original.
-- Idempotente — ON CONFLICT DO NOTHING no sobreescribe valores editados por el admin.

INSERT INTO engine_params (key, value, description) VALUES
  ('transfer_max_route_eta_s',     180,  'ETA de ruta máximo (s) para disparar rebalanceo automático en un driver'),
  ('default_bag_capacity_liters',  25,   'Litros de capacidad de mochila si el driver no especificó la suya')
ON CONFLICT (key) DO NOTHING;

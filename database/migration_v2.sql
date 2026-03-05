-- Tabla de quejas de clientes
create table if not exists order_complaints (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  customer_id uuid not null references users(id),
  text text not null,
  created_at timestamptz not null default now()
);

-- Nota de sugerencia (ya está embebida en suggestion_text JSON, no requiere columna extra)
-- display_name ya está en full_name de users (se reutiliza el campo existente)

-- Campo suggestion_note en orders (alternativo si quieres columna separada — opcional)
-- alter table orders add column if not exists suggestion_note text;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('customer', 'restaurant', 'driver', 'admin');
CREATE TYPE account_status AS ENUM ('active', 'suspended');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  status account_status NOT NULL DEFAULT 'active',
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  name VARCHAR(140) NOT NULL,
  category VARCHAR(80) NOT NULL,
  address TEXT,
  is_open BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  name VARCHAR(140) NOT NULL,
  description TEXT,
  price_cents INT NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE driver_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  driver_number BIGSERIAL UNIQUE,
  vehicle_type VARCHAR(50),
  is_verified BOOLEAN NOT NULL DEFAULT false,
  is_available BOOLEAN NOT NULL DEFAULT false,
  last_lat NUMERIC(9,6),
  last_lng NUMERIC(9,6)
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  driver_id UUID REFERENCES users(id),
  status VARCHAR(30) NOT NULL,
  total_cents INT NOT NULL,
  delivery_address TEXT NOT NULL,
  suggestion_text TEXT,
  suggestion_status VARCHAR(20) NOT NULL DEFAULT 'none',
  driver_note TEXT,
  restaurant_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id),
  quantity INT NOT NULL,
  unit_price_cents INT NOT NULL
);

CREATE TABLE order_driver_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(order_id, driver_id)
);

CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_driver ON orders(driver_id);
CREATE INDEX idx_orders_restaurant ON orders(restaurant_id);
CREATE INDEX idx_order_driver_offers_order ON order_driver_offers(order_id);
CREATE INDEX idx_order_driver_offers_driver ON order_driver_offers(driver_id);

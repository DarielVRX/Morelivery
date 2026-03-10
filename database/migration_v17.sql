-- migration_v17.sql
-- Permite preservar historial de order_items cuando se elimina un producto del menú.
-- La columna menu_item_id pasa a ser nullable; los items huérfanos retienen nombre
-- y precio pero pierden la referencia al producto.

ALTER TABLE order_items
  ALTER COLUMN menu_item_id DROP NOT NULL;

ALTER TABLE order_items
  DROP CONSTRAINT IF EXISTS order_items_menu_item_id_fkey;

ALTER TABLE order_items
  ADD CONSTRAINT order_items_menu_item_id_fkey
    FOREIGN KEY (menu_item_id)
    REFERENCES menu_items(id)
    ON DELETE SET NULL;

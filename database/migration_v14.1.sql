DO $$
DECLARE
    col_exists BOOLEAN;
BEGIN
    -- Revisar si la columna tip_cents ya existe en la tabla orders
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='orders' AND column_name='tip_cents'
    ) INTO col_exists;

    IF col_exists THEN
        RAISE NOTICE 'ESTADO: La columna [tip_cents] ya existe en la tabla orders.';
    ELSE
        -- Crear la columna si no existe
        ALTER TABLE orders ADD COLUMN tip_cents INTEGER NOT NULL DEFAULT 0;
        RAISE NOTICE 'ESTADO: Columna [tip_cents] CREADA exitosamente en la tabla orders.';
    END IF;

    -- Opcional: Asegurar que payment_method también esté presente
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='payment_method') THEN
        ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash';
        RAISE NOTICE 'ESTADO: Columna [payment_method] CREADA exitosamente.';
    ELSE
        RAISE NOTICE 'ESTADO: La columna [payment_method] ya existía.';
    END IF;
END $$;

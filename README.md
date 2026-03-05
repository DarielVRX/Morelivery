# Morelivery Beta (Delivery Marketplace)

Beta funcional enfocada en seguridad, modularidad y escalabilidad para marketplace de delivery con 4 roles.

## 1) Arquitectura del sistema

### Componentes
- **Frontend (`/frontend`)**: React responsive + PWA.
- **Backend (`/backend`)**: Express API REST modular con RBAC.
- **Base de datos (`/database`)**: PostgreSQL normalizada.
- **Eventos tiempo real**: Socket.IO para estado de pedidos.
- **Cache opcional**: Redis para pedidos activos y colas ligeras.

### Decisiones de arquitectura
- Separación por dominios (`auth`, `orders`, `restaurants`, `drivers`, `admin`).
- Middlewares compartidos para seguridad (helmet, rate-limit, validación, auth).
- SQL parametrizado para evitar inyección.
- Diseño preparado para migrar a microservicios en fases futuras sin romper contratos REST.

## 2) Seguridad implementada (beta)
- JWT firmado con expiración.
- Password hashing con bcrypt (cost 12).
- RBAC estricto por rol en endpoints sensibles.
- Validación de input con Zod en auth.
- Helmet + CORS controlado + rate limiting.
- Logs de eventos críticos (`auth.login`, `order.created`, `order.status_changed`).
- Variables sensibles en `.env` (no expuestas en frontend).
- Preparado para HTTPS (forzado por plataforma de despliegue: Vercel/Render/Supabase).

## 3) Esquema de base de datos
Ver `database/schema.sql`.

Entidades principales:
- `users`
- `restaurants`
- `menu_items`
- `driver_profiles`
- `orders`
- `order_items`

## 4) Estructura de carpetas

```txt
/frontend
/backend
/database
/auth
/orders
/restaurants
/drivers
/admin
```

## 5) API REST base

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`

### Cliente
- `GET /api/restaurants`
- `GET /api/restaurants/:id/menu`
- `POST /api/orders`
- `GET /api/orders/my`

### Restaurante
- `POST /api/restaurants/menu-items`
- `PATCH /api/orders/:id/status`

### Repartidor
- `PATCH /api/drivers/availability`
- `POST /api/drivers/orders/:id/respond`
- `PATCH /api/orders/:id/status`

### Admin
- `GET /api/admin/orders`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id/suspend`

## 6) Flujo completo de pedido (ejemplo)
1. Cliente autenticado consulta restaurantes y menú.
2. Cliente crea pedido (`status=created`).
3. Restaurante cambia estado a `accepted` y luego `preparing`, `ready`.
4. Repartidor disponible acepta pedido (`status=assigned`).
5. Repartidor actualiza a `on_the_way` y `delivered`.
6. Cliente visualiza cambios en tiempo real por evento `order:update`.

## 7) Ejecución local

### Backend
```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

## 8) Despliegue gratis

### Frontend (Vercel)
1. Importar repo en Vercel.
2. Root directory: `frontend`.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Variable: `VITE_API_URL=https://<tu-backend>/api`.

### Backend (Render)
1. Crear Web Service desde repo.
2. Root directory: `backend`.
3. Start command: `npm start`.
4. Variables: `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, `NODE_ENV=production`.

### PostgreSQL (Supabase o Render Postgres)
1. Crear instancia.
2. Ejecutar `database/schema.sql`.
3. Configurar `DATABASE_URL` en backend.

## 9) Escalabilidad futura recomendada
- Colas (BullMQ/RabbitMQ) para asignación automática de repartidores.
- Redis obligatorio para estado activo/geolocalización.
- Observabilidad (OpenTelemetry + dashboards).
- Particionamiento de tabla `orders` por fecha.
- Migrar autenticación a proveedor externo (Auth0/Supabase Auth) si crece el equipo.

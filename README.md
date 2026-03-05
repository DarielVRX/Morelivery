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
- Validación de input con Zod en auth/orders/drivers/restaurants/admin.
- Sanitización básica de texto de formularios en backend.
- Helmet + CORS controlado + rate limiting.
- Logs de eventos críticos (`auth.login`, `order.created`, `order.status_changed`, `admin.user_suspended`).
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

## 6) ¿Cómo debe verse y funcionar la página principal?
La home de cliente debe:
1. Mostrar restaurantes disponibles/abiertos.
2. Mostrar propuesta de valor en 3 pasos: descubrir, pedir, recibir.
3. Tener un CTA claro a explorar menús y crear pedido.
4. Refrescar estados del pedido en tiempo real (evento `order:update`).

En esta beta, la home ya incluye listado de restaurantes + cards de flujo funcional.

## 7) Flujo completo de pedido (ejemplo)
1. Cliente autenticado consulta restaurantes y menú.
2. Cliente crea pedido (`status=created`).
3. Restaurante cambia estado a `accepted` y luego `preparing`, `ready`.
4. Repartidor disponible acepta pedido (`status=assigned`).
5. Repartidor actualiza a `on_the_way` y `delivered`.
6. Cliente visualiza cambios en tiempo real por evento `order:update`.

## 8) Ejecución local

### Desde la raíz (monorepo)
```bash
npm run install:all
npm run dev:backend
npm run dev:frontend
```

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

## 9) ¿Es desplegable desde raíz?
**Sí**, con dos opciones:
1. **Render Blueprint (`render.yaml`) desde raíz**: crea API + sitio estático usando `rootDir` por servicio.
2. **Despliegue separado desde raíz del repo**:
   - Vercel: seleccionar `frontend` como Root Directory.
   - Render: seleccionar `backend` como Root Directory.

No se recomienda un único servicio root para frontend+backend en beta; mejor separar para escalar y aislar fallos.

## 10) Despliegue gratis

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
4. Variables: `DATABASE_URL`, `JWT_SECRET`, `ALLOWED_ORIGINS`, `NODE_ENV=production`.

### PostgreSQL (Supabase o Render Postgres)
1. Crear instancia.
2. Ejecutar `database/schema.sql`.
3. Configurar `DATABASE_URL` en backend.

## 11) Escalabilidad futura recomendada
- Colas (BullMQ/RabbitMQ) para asignación automática de repartidores.
- Redis obligatorio para estado activo/geolocalización.
- Observabilidad (OpenTelemetry + dashboards).
- Particionamiento de tabla `orders` por fecha.
- Migrar autenticación a proveedor externo (Auth0/Supabase Auth) si crece el equipo.


## 12) Estado esperado con tus URLs actuales
Si tu backend está en `https://morelivery.onrender.com/` y frontend en `https://morelivery-frontend.vercel.app/`, debería verse así:

- `https://morelivery.onrender.com/` → JSON con `service: morelivery-api`, `status: online` y rutas principales.
- `https://morelivery.onrender.com/health` → JSON con `status: ok` y `allowedOrigins` incluyendo tu dominio de Vercel.
- `https://morelivery-frontend.vercel.app/` → web React cargando restaurantes desde `VITE_API_URL=https://morelivery.onrender.com/api`.

Variables recomendadas en Render:

```bash
NODE_ENV=production
ALLOWED_ORIGINS=https://morelivery-frontend.vercel.app,https://morelivery.onrender.com
JWT_SECRET=<secreto-largo>
DATABASE_URL=<postgres-url>
```

Variable recomendada en Vercel:

```bash
VITE_API_URL=https://morelivery.onrender.com/api
```


## 13) Flujo de pruebas rápido (beta)
1. Registra 1 `restaurant`, 1 `customer`, 1+ `driver` desde el frontend (solo username/password/role).
2. Login como restaurante y agrega productos (descripción + precio).
3. Login como cliente, selecciona restaurante, arma cantidades y crea pedido.
4. El backend asigna automáticamente el pedido al repartidor disponible con menor `driver_number`.
5. Login como repartidor y avanza estado (`on_the_way`, `delivered`).

## 14) SQL mínimo para DB existente
Si ya tenías tablas creadas, ejecuta:

```sql
create extension if not exists pgcrypto;
alter table driver_profiles add column if not exists driver_number bigserial;
create unique index if not exists driver_profiles_driver_number_unique on driver_profiles(driver_number);
```


## 15) Auth de pruebas sin email real
- El registro/login beta usa `username` + `password` (sin verificación de email).
- Internamente backend genera un pseudo-email técnico (`<username>@local.test`) solo para compatibilidad del esquema actual.

# Morelivery — Inventario funcional del repositorio

Este README ya no es una guía de instalación: ahora funciona como **mapa corto del código**. Enumera **todos los archivos versionados** del proyecto y resume para qué sirve cada uno, señalando debilidades cuando conviene.

## Raíz del repositorio

- `.gitignore`: reglas para excluir artefactos locales, temporales y dependencias del control de versiones.
- `.vscode/settings.json`: ajustes de editor para quien trabaje con VS Code.
- `LICENSE`: licencia del proyecto.
- `Morelivery.txt`: volcado textual grande del proyecto usado como referencia o snapshot; **debilidad:** se desactualiza fácil y duplica información del código real.
- `Morelivery.zip`: paquete comprimido del proyecto; **debilidad:** es un respaldo opaco que complica revisar cambios por diff.
- `README.md`: este inventario funcional del repositorio.
- `backup_full.sql`: respaldo SQL amplio de la base; **debilidad:** puede divergir del esquema canónico y de los datos vigentes.
- `package-lock.json`: lockfile del monorepo npm para fijar versiones exactas.
- `package.json`: configuración del workspace raíz y scripts compartidos entre backend y frontend.
- `render.yaml`: blueprint de despliegue para Render.
- `supabase_data.sql`: dump de datos orientado a restauración/carga de ejemplo; **debilidad:** arrastra estado histórico difícil de validar automáticamente.
- `tree.txt`: árbol de archivos exportado manualmente; **debilidad:** ya no representa fielmente la estructura actual.

## Documentación complementaria

- `docs/architecture-audit.md`: auditoría técnica y lista de deudas/pendientes del sistema.
- `admin/README.md`: nota de contexto del área administrativa; hoy sirve más como referencia histórica que como documentación viva.
- `auth/README.md`: nota de contexto del dominio de autenticación; **debilidad:** no sustituye revisar el flujo real en código.
- `drivers/README.md`: resumen funcional del área de conductores.
- `orders/README.md`: documentación puntual del dominio de pedidos.
- `restaurants/README.md`: documentación puntual del dominio de restaurantes.

## Base de datos y scripts SQL

- `database/init-db.js`: inicializa la base aplicando el esquema canónico desde `DATABASE_URL`.
- `database/schema.sql`: esquema principal y fuente de verdad de tablas, índices y defaults.
- `database/migration_chat_reopen.sql`: migración puntual para reabrir o ajustar lógica de chat; **debilidad:** coexistir con `schema.sql` obliga a comprobar si sigue siendo necesaria.
- `database/migration_cover_photo.sql`: migración histórica para foto de portada/perfil; **debilidad:** ya no es la fuente principal del modelo.
- `database/migration_prep_corrections.sql`: migración para correcciones del flujo de preparación/cocina.
- `database/migration_support.sql`: migración para tablas o columnas del sistema de soporte.

## Backend

### Paquete y arranque

- `backend/package.json`: dependencias y scripts de ejecución del backend Express.
- `backend/src/app.js`: fábrica de la app Express que une middleware, rutas y manejo global de errores.
- `backend/src/server.js`: arranque HTTP, bootstrap de schedulers y conexión del callback de ofertas SSE.
- `backend/test-db.js`: prueba mínima de conectividad a PostgreSQL; **debilidad:** la cobertura de pruebas del backend sigue siendo muy limitada.

### Bootstrap

- `backend/src/bootstrap/middleware.js`: registra CORS, Helmet, JSON, cookies, healthchecks y rate limiting.
- `backend/src/bootstrap/routes.js`: monta todos los routers de la API y sus aliases sin prefijo.
- `backend/src/bootstrap/schedulers.js`: crea y coordina loops periódicos del motor operativo.

### Configuración

- `backend/src/config/db.js`: pool PostgreSQL, helper `query` y chequeos básicos de conexión.
- `backend/src/config/env.js`: lectura de variables de entorno y normalización de configuración global.
- `backend/src/config/redis.js`: creación perezosa del cliente Redis cuando existe `REDIS_URL`.

### Utilidades y base transversal

- `backend/src/utils/errors.js`: clase `AppError` para errores de negocio con código HTTP.
- `backend/src/utils/geo.js`: helpers geográficos compartidos para distancias, formatos cortos y coordenadas.
- `backend/src/utils/logger.js`: logger estructurado simple para eventos críticos.
- `backend/src/events/orderEvents.js`: stub histórico de eventos de pedido; **debilidad:** se mantiene solo por compatibilidad mientras el tiempo real real usa SSE.
- `backend/src/middlewares/auth.js`: autenticación JWT y autorización por rol.
- `backend/src/middlewares/errorHandler.js`: respuesta uniforme para 404 y errores controlados/no controlados.
- `backend/src/middlewares/rateLimit.js`: límites de tasa para auth y API general.
- `backend/src/middlewares/validate.js`: adaptador de validación Zod para bodies HTTP.

### Motor de asignación y operaciones

- `backend/src/engine/candidate-finder.js`: busca conductores candidatos elegibles consultando DB y estimaciones OSRM.
- `backend/src/engine/eta.js`: estimador de ETA con OSRM y caché agresiva.
- `backend/src/engine/kitchen.js`: lógica del “motor de cocina”, estimados de preparación y ajustes automáticos.
- `backend/src/engine/osrm-cache.js`: cliente OSRM con memoización por grilla para bajar costo de routing.
- `backend/src/engine/params.js`: carga/caché de parámetros dinámicos del motor desde la base.
- `backend/src/engine/rebalancer.js`: rebalancea pedidos entre conductores cuando detecta mejores candidatos.
- `backend/src/engine/route-simulator.js`: simula inserción de pedidos en rutas activas para validar SLA y viabilidad.
- `backend/src/engine/scoring.js`: función de scoring/costo usada para comparar candidatos.
- `backend/src/engine/stale.js`: limpia entidades obsoletas o inconsistentes del runtime.

### Módulo de eventos en tiempo real

- `backend/src/modules/events/hub.js`: hub SSE en memoria que registra clientes y envía eventos por usuario o rol.
- `backend/src/modules/events/offerCallback.js`: callback compartido que conecta el motor de ofertas con SSE.
- `backend/src/modules/events/routes.js`: endpoint `/events` con autenticación, heartbeat y reconexión orientada a EventSource.

### Autenticación

- `backend/src/modules/auth/routes.js`: endpoints de registro, login, perfil, recuperación y auth social.
- `backend/src/modules/auth/schemas.js`: contratos Zod del dominio de autenticación.
- `backend/src/modules/auth/service.js`: lógica pesada de usuarios, contraseñas, JWT, Google auth y perfil; **debilidad:** concentra demasiada responsabilidad en un archivo grande.

### Administración

- `backend/src/modules/admin/routes.js`: panel operativo/admin para usuarios, pedidos, parámetros y reportes.
- `backend/src/modules/admin/schemas.js`: validaciones Zod del dominio administrativo.

### Restaurantes

- `backend/src/modules/restaurants/routes.js`: CRUD operativo de restaurante, menú, horarios y ajustes de cocina.
- `backend/src/modules/restaurants/schemas.js`: validaciones de alta/edición de productos y datos del restaurante.

### Conductores

- `backend/src/modules/drivers/routes.js`: disponibilidad, counters, ofertas, pedidos activos, ubicación y acciones del conductor.
- `backend/src/modules/drivers/schemas.js`: validaciones del dominio de conductores.

### Navegación y mapa

- `backend/src/modules/nav/map-match.js`: suavizado/map matching de posiciones GPS para navegación.
- `backend/src/modules/nav/road-prefs.js`: incidencias o preferencias de camino compartidas por conductores con difusión SSE.
- `backend/src/modules/nav/zones.js`: zonas geográficas reportadas/editables por conductores.

### Notificaciones

- `backend/src/modules/notifications/routes.js`: endpoints para registrar o borrar suscripciones push; **debilidad:** la funcionalidad sigue incompleta si no se monta/configura end-to-end.
- `backend/src/modules/notifications/pushSubscription.js`: persistencia y envío Web Push VAPID; **debilidad:** sigue siendo una de las áreas más frágiles/incompletas del backend actual.

### Pedidos

- `backend/src/modules/orders/routes.js`: router principal que compone subgrupos de creación, lifecycle, soporte, historial y ratings.
- `backend/src/modules/orders/schemas.js`: validaciones Zod de creación, sugerencias y cambios de estado.
- `backend/src/modules/orders/shared.js`: dependencias compartidas, notificación a participantes y utilidades comunes del dominio.
- `backend/src/modules/orders/ratings.js`: router de reseñas/calificaciones de pedidos, restaurantes y conductores.

#### Subgrupos de rutas de pedidos

- `backend/src/modules/orders/route-groups/creation.js`: alta de pedidos, cálculo de totales y disparo inicial del flujo operativo.
- `backend/src/modules/orders/route-groups/history.js`: historial, propinas posteriores y lecturas auxiliares de pedidos.
- `backend/src/modules/orders/route-groups/lifecycle.js`: transiciones de estado, side effects y eventos del ciclo de vida.
- `backend/src/modules/orders/route-groups/suggestions.js`: sugerencias/cambios de pedido y respuesta del cliente.
- `backend/src/modules/orders/route-groups/support.js`: chat, incidencias y reglas temporales de soporte ligadas a pedidos.

#### Motor interno de asignación

- `backend/src/modules/orders/assignment/index.js`: fachada pública del motor de asignación.
- `backend/src/modules/orders/assignment/constants.js`: constantes operativas, timers y helpers de logging del motor.
- `backend/src/modules/orders/assignment/cooldown.js`: reducción de cooldown cuando no hay candidatos elegibles.
- `backend/src/modules/orders/assignment/core.js`: algoritmo central que selecciona batches y orquesta ofertas.
- `backend/src/modules/orders/assignment/events.js`: eventos externos del motor como aceptar, rechazar, liberar o expirar.
- `backend/src/modules/orders/assignment/offer.js`: inserta/oferta pedidos a conductores evitando duplicados.
- `backend/src/modules/orders/assignment/queries.js`: capa SQL del motor de asignación.
- `backend/src/modules/orders/assignment/queue.js`: serializa la ejecución por `orderId` para evitar carreras.

### Otras áreas backend

- `backend/src/modules/payments/routes.js`: contratos HTTP de pagos; **debilidad:** es un placeholder y aún no integra procesador real.
- `backend/src/modules/routes/routes.js`: endpoint de modelado/routing auxiliar con apoyo de OSRM.
- `backend/src/modules/support/routes.js`: tickets de soporte generales fuera del contexto estricto de un pedido.

## Frontend

### Paquete, shell y build

- `frontend/index.html`: shell HTML que monta React/Vite.
- `frontend/package.json`: dependencias y scripts del frontend.
- `frontend/vercel.json`: configuración de despliegue en Vercel.
- `frontend/vite.config.js`: configuración de Vite para desarrollo y build.

### Assets públicos y PWA

- `frontend/public/badge.svg`: badge usado por notificaciones y PWA.
- `frontend/public/icon-192.png`: ícono PWA de 192 px.
- `frontend/public/icon-512.png`: ícono PWA de 512 px.
- `frontend/public/logo.svg`: logotipo vectorial principal.
- `frontend/public/manifest.webmanifest`: manifiesto de instalación PWA.
- `frontend/public/sw.js`: service worker con caché, sync offline, badge y notificaciones; **debilidad:** concentra mucha responsabilidad en un único archivo.

### Arranque, contexto y cliente API

- `frontend/src/main.jsx`: arranque de React, registro del SW y prompt inicial de notificaciones; **debilidad:** hoy comparte parte de la lógica de push con hooks especializados.
- `frontend/src/App.jsx`: enrutador real de la app, layout global, iconografía común y orquestación de pantallas; **debilidad:** sigue siendo un archivo grande para la cantidad de roles/flows.
- `frontend/src/api/client.js`: cliente HTTP base, normalización de `API_BASE` y manejo básico de token expirado.
- `frontend/src/contexts/AuthContext.jsx`: sesión, login/logout y estado del usuario autenticado.
- `frontend/src/contexts/ThemeContext.jsx`: tema claro/oscuro y persistencia de preferencia visual.

### Componentes compartidos

- `frontend/src/components/ActiveOrderPanel.jsx`: panel compacto del conductor para pedido activo.
- `frontend/src/components/DriverMap.jsx`: mapa principal del conductor con ruta, GPS y overlays; **debilidad:** componente complejo y crítico, candidato a más segmentación.
- `frontend/src/components/FeeBreakdown.jsx`: desglose visual de montos, comisiones y propinas.
- `frontend/src/components/Layout.jsx`: contenedor/base visual común entre pantallas.
- `frontend/src/components/NavFABs.jsx`: botones flotantes de navegación y acciones rápidas del conductor.
- `frontend/src/components/OfferCountdown.jsx`: countdown visual para ofertas con tiempo límite.
- `frontend/src/components/OfferPanel.jsx`: tarjeta/panel de oferta activa para conductor.
- `frontend/src/components/OrderMap.jsx`: mapa del pedido del cliente/restaurante.
- `frontend/src/components/PullToRefresh.jsx`: gesto móvil de recarga manual tipo app nativa.
- `frontend/src/components/ScheduleEditor.jsx`: editor reutilizable de horarios semanales de restaurante.
- `frontend/src/components/SplitLayout.jsx`: layout dividido para páginas con dos paneles o columnas.
- `frontend/src/components/WayPicker.jsx`: selector de trayecto y navegación dentro del mapa del conductor.
- `frontend/src/components/ZoneLayer.jsx`: capa visual de zonas/incidencias reportadas.
- `frontend/src/components/ZonePlacer.jsx`: herramienta para crear o sugerir zonas desde el mapa.

### Features de administración

- `frontend/src/features/admin/dashboard/sections.jsx`: secciones/tab panels del dashboard admin.
- `frontend/src/features/admin/dashboard/shared.jsx`: helpers visuales, tablas, formateo y utilidades del dashboard admin.

### Features del cliente

- `frontend/src/features/customer/AddressSearchBar.jsx`: búsqueda y selección de dirección con mapa/geocodificación.
- `frontend/src/features/customer/home/RestaurantCard.jsx`: tarjeta de restaurante en home del cliente.
- `frontend/src/features/customer/home/SuggestionBanner.jsx`: banner de recomendaciones o sugerencias contextuales.
- `frontend/src/features/customer/home/icons.jsx`: iconos específicos del home del cliente.
- `frontend/src/features/customer/home/utils.js`: helpers pequeños del home del cliente.
- `frontend/src/features/customer/orders/components.jsx`: componentes del detalle/historial de pedidos del cliente, chat y rating; **debilidad:** concentra muchas piezas de UI del dominio.
- `frontend/src/features/customer/restaurant-page/components.jsx`: iconos y componentes auxiliares de la página de restaurante.

### Features del conductor

- `frontend/src/features/driver/home/DriverHomeMapSection.jsx`: composición del mapa, FABs, zonas y navegación del home del conductor.
- `frontend/src/features/driver/home/DriverHomeStatusBar.jsx`: barra superior de estado, disponibilidad y banners del conductor.
- `frontend/src/features/driver/home/animations.js`: inyección de animaciones CSS del home de conductor.
- `frontend/src/features/driver/home/api.js`: adaptadores HTTP del home de conductor.
- `frontend/src/features/driver/home/navigation.js`: cálculo de stops pickup/delivery para navegación del conductor.
- `frontend/src/features/driver/home/useDriverHomeRuntime.js`: hook orquestador del home del conductor; **debilidad:** sigue siendo una pieza compleja de coordinación.
- `frontend/src/features/driver/map/config.js`: estilos/constantes de mapas Stadia/OpenFreeMap.
- `frontend/src/features/driver/map/helpers.js`: helpers geométricos y de fuentes/capas para MapLibre.
- `frontend/src/features/driver/map/overlays.jsx`: overlays visuales del mapa del conductor.
- `frontend/src/features/driver/orders/components.jsx`: tarjetas y bloques UI de pedidos para el panel del conductor.
- `frontend/src/features/driver/orders/useDriverOrdersPageState.js`: estado derivado de la página de pedidos del conductor.
- `frontend/src/features/driver/shared/orderUtils.js`: cálculos monetarios y utilidades comunes del dominio conductor.

### Features transversales de pedidos y perfil

- `frontend/src/features/orders/drafts.js`: construcción de borradores para sugerencias y cantidades.
- `frontend/src/features/orders/status.js`: utilidades para clasificar estados terminales y activos.
- `frontend/src/features/profile/components.jsx`: componentes auxiliares de perfil, mapas y campos reutilizables.
- `frontend/src/features/profile/sections.jsx`: secciones visuales de perfil, seguridad y ajustes.
- `frontend/src/features/profile/useProfilePersonalInfo.js`: hook de edición de datos personales y dirección.
- `frontend/src/features/profile/useProfileSecurity.js`: hook para username, contraseña y seguridad de cuenta.
- `frontend/src/features/profile/useProfileSettings.js`: hook de settings/permisos de la cuenta.
- `frontend/src/features/support/SupportChat.jsx`: chat/tickets de soporte general; **debilidad:** mezcla vista de usuario y admin en un mismo feature amplio.

### Hooks compartidos

- `frontend/src/hooks/useAppBadge.js`: sincroniza el badge del ícono de la app según estado actual.
- `frontend/src/hooks/useDriverLocation.js`: envío periódico de GPS del conductor al backend.
- `frontend/src/hooks/useDriverOrders.js`: carga, clasificación y actualización de pedidos del conductor.
- `frontend/src/hooks/useNavFeatures.js`: estado de reportes de zonas e incidencias de navegación.
- `frontend/src/hooks/useOfferCountdown.js`: cuenta regresiva basada en tiempos del servidor.
- `frontend/src/hooks/useOrderManager.js`: cerebro operativo del home del conductor; **debilidad:** sigue concentrando bastante lógica crítica en un solo hook.
- `frontend/src/hooks/usePermissions.js`: permisos PWA (notificaciones, geolocalización, persistencia, wake lock).
- `frontend/src/hooks/useRealtimeOrders.js`: conexión SSE, reconexión y disparo de notificaciones locales; **debilidad:** comparte frontera funcional con `main.jsx` y el SW.

### Páginas

- `frontend/src/pages/Admin/Dashboard.jsx`: pantalla principal del panel admin; **debilidad:** archivo grande con bastante UI y estado en la misma pieza.
- `frontend/src/pages/AuthPage.jsx`: login, registro y recuperación de acceso.
- `frontend/src/pages/Customer/Home.jsx`: home del cliente con búsqueda, restaurantes y sugerencias.
- `frontend/src/pages/Customer/Orders.jsx`: historial/detalle de pedidos del cliente con SSE, chat y ratings; **debilidad:** pantalla extensa y muy cargada de responsabilidades.
- `frontend/src/pages/Customer/Payments.jsx`: checkout/pago del cliente; **debilidad:** el flujo real de pago online todavía depende de placeholders backend.
- `frontend/src/pages/Customer/RestaurantPage.jsx`: menú, carrito y selección de entrega para un restaurante.
- `frontend/src/pages/Driver/Earnings.jsx`: resumen de ingresos del conductor por periodos.
- `frontend/src/pages/Driver/Home.jsx`: composición principal del home del conductor a partir de hooks y componentes.
- `frontend/src/pages/Driver/Orders.jsx`: lista/panel de pedidos disponibles, activos e históricos del conductor.
- `frontend/src/pages/Profile.jsx`: pantalla de perfil que une secciones de datos, seguridad y permisos.
- `frontend/src/pages/ResetPasswordPage.jsx`: cambio de contraseña usando token recibido por email.
- `frontend/src/pages/Restaurant/Menu.jsx`: gestión de productos y empaques del restaurante.
- `frontend/src/pages/Restaurant/Orders.jsx`: panel operativo de pedidos del restaurante con SSE, badges y chat; **debilidad:** otra pantalla grande y central del sistema.
- `frontend/src/pages/Restaurant/Schedule.jsx`: pantalla para editar horario semanal del restaurante.

### Estilos y utilidades

- `frontend/src/styles/app.css`: sistema de diseño global, variables, layout base y estilos compartidos.
- `frontend/src/utils/audio.js`: sonidos generados con Web Audio para ofertas/alertas.
- `frontend/src/utils/errorMessage.js`: normalizador de mensajes visibles de error.
- `frontend/src/utils/format.js`: formateadores y etiquetas de dominio compartidas.
- `frontend/src/utils/geo.js`: utilidades geométricas y de distancia usadas por mapas y navegación.
- `frontend/src/utils/geocode.js`: reverse geocoding con Nominatim y extracción de campos estructurados.
- `frontend/src/utils/mapLibre.js`: carga dinámica de MapLibre GL desde CDN; **debilidad:** depende de recursos remotos externos en runtime.
- `frontend/src/utils/passwordUtils.jsx`: validación y medidor visual de fortaleza de contraseña.
- `frontend/src/utils/pendingOrder.js`: persistencia temporal del pedido pendiente en `sessionStorage`.

## Lectura rápida de debilidades globales

- El **sistema de notificaciones push** todavía requiere cierre end-to-end, aunque el tiempo real por SSE ya está bastante trabajado.
- Varias pantallas y hooks clave (`App.jsx`, `Auth service`, `DriverMap`, `Customer/Orders`, `Restaurant/Orders`, `Admin/Dashboard`, `useOrderManager`) siguen siendo piezas grandes.
- Hay **artefactos de respaldo o snapshot** (`Morelivery.txt`, `Morelivery.zip`, `backup_full.sql`, `supabase_data.sql`, `tree.txt`) útiles como apoyo, pero proclives a quedarse viejos.
- El backend de **pagos** conserva contratos pero no integración real con proveedor.

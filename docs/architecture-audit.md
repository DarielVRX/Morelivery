# Auditoría técnica y plan de escalabilidad

## Cambios aplicados en esta iteración

### 1. Segmentación del bootstrap del backend
- Se separó el registro de rutas en `backend/src/bootstrap/routes.js`.
- Se separó la configuración transversal (CORS, Helmet, JSON, cookies, healthchecks) en `backend/src/bootstrap/middleware.js`.
- Se encapsularon los schedulers del motor en `backend/src/bootstrap/schedulers.js` para facilitar agregar nuevos loops sin seguir creciendo `server.js`.

### 2. Consolidación del esquema SQL
- `database/schema.sql` ahora representa el estado canónico completo de la base de datos.
- Se integraron en un único archivo las columnas, índices, tablas auxiliares, trigger de `accepted_at` y defaults de `engine_params` que antes estaban repartidos en migraciones incrementales.
- `database/init-db.js` dejó de depender de credenciales hardcodeadas y ahora aplica el schema usando `DATABASE_URL`.

### 3. Eliminación de artefactos muertos
- Se eliminaron las migraciones históricas bajo `database/migration*.sql` tras consolidar su contenido en `schema.sql`.
- Se eliminaron backups `.bak` y notas `.txt` del motor de asignación que no estaban referenciados por el runtime.
- Se eliminó `backend/src/utils/sanitize.js` porque no tenía referencias activas en backend ni frontend.

## Hallazgos importantes

### Código muerto o incompleto detectado
1. **Push notifications incompletas**
   - El frontend intenta registrar una suscripción en `/api/push/subscribe`.
   - No existe un módulo backend equivalente ni uso real de `push_subscriptions` en runtime.
   - Recomendación: o terminar el feature end-to-end o eliminar la integración parcial del frontend para reducir ruido operativo.

2. **Artefactos de respaldo dentro del repo principal**
   - Los archivos en `backups/` y los `.txt` dentro de `orders/assignment` eran documentación/respaldos, no parte del código ejecutable.
   - Tenerlos mezclados con runtime complica revisiones, búsquedas y mantenimiento.

3. **Script de inicialización inseguro**
   - `database/init-db.js` contenía usuario, password y base hardcodeados.
   - Además asumía que siempre debía crear una base desde cero, lo cual no escala bien para CI/CD ni entornos remotos.

### Tablas que podrían unificarse a futuro
Estas unificaciones **no se aplicaron ahora** para no romper compatibilidad con el backend actual, pero son buenos candidatos para una siguiente fase:

1. **`road_zones` + `impassable_reports`**
   - Ambas modelan incidencias geográficas temporales.
   - Podrían converger a una tabla genérica como `map_alerts` con subtipo, estado, consenso y metadata de expiración.
   - Beneficio: menos lógica duplicada en navegación y moderación.

2. **Direcciones estructuradas duplicadas en `users` y `restaurants`**
   - `postal_code`, `colonia`, `estado`, `ciudad`, `home_lat`, `home_lng` aparecen en ambas tablas.
   - A futuro se puede abstraer hacia una tabla `addresses` o un bloque reutilizable si el dominio sigue creciendo.
   - Riesgo actual: bajo funcional, pero alto en deuda de consistencia.

3. **Canales de soporte post-order**
   - `order_complaints` y `order_reports` se parecen bastante semánticamente.
   - Se podría evolucionar a una tabla `order_incidents` con tipo de incidente, autor y workflow de revisión.

## Riesgos heredados que conviene atacar después
- Los módulos de rutas grandes (`orders`, `admin`, `drivers`, varias páginas del frontend) siguen siendo archivos extensos y merecen una segunda ronda de segmentación por casos de uso.
- El esquema aún usa varios `VARCHAR/TEXT` para estados de negocio (`orders.status`, `order_driver_offers.status`, etc.). Convertirlos a enums o catálogos reduciría errores de consistencia.
- Falta una capa formal de migraciones versionadas moderna (por ejemplo Drizzle/Prisma/Knex/Flyway) si en el futuro vuelven a introducir cambios incrementales sobre producción.

## Recomendación de siguiente fase
1. Dividir `backend/src/modules/orders/routes.js` por subdominios: creación, lifecycle, chat/reportes y ratings.
2. Introducir tests de integración mínimos sobre flujos críticos de pedido.
3. Resolver la funcionalidad incompleta de push notifications.
4. Normalizar el modelo de incidencias geográficas.

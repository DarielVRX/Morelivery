import webpush from 'web-push';
import { query } from '../../config/db.js';
import { env } from '../../config/env.js';

webpush.setVapidDetails(
    `mailto:${env.vapidEmail}`,
    env.vapidPublicKey,
    env.vapidPrivateKey,
);

/**
 * Guarda o actualiza la suscripción push de un usuario.
 * Un usuario puede tener varias (distintos dispositivos/navegadores).
 * Se usa el endpoint como clave única — si ya existe, actualiza keys.
 */
export async function savePushSubscription(userId, subscription) {
    const { endpoint, keys } = subscription;
    await query(
        `INSERT INTO push_subscriptions (user_id, endpoint, keys, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (endpoint)
        DO UPDATE SET user_id=$1, keys=$3, updated_at=NOW()`,
                [userId, endpoint, JSON.stringify(keys)],
    );
}

/**
 * Envía notificación push a todos los dispositivos de un usuario.
 * Elimina automáticamente suscripciones expiradas (410/404).
 */
export async function sendPushToUser(userId, payload) {
    const { rows } = await query(
        'SELECT endpoint, keys FROM push_subscriptions WHERE user_id=$1',
        [userId],
    );
    const results = await Promise.allSettled(
        rows.map(row =>
        webpush.sendNotification(
            { endpoint: row.endpoint, keys: row.keys },
            JSON.stringify(payload),
        ).catch(async err => {
            if (err.statusCode === 410 || err.statusCode === 404) {
                // Suscripción expirada — limpiar
                await query('DELETE FROM push_subscriptions WHERE endpoint=$1', [row.endpoint]);
            }
            throw err;
        }),
        ),
    );
    return results;
}

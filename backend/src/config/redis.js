import { createClient } from 'redis';
import { env } from './env.js';

let redisClient;

export async function getRedisClient() {
  if (!env.redisUrl) return null;
  if (redisClient) return redisClient;

  redisClient = createClient({ url: env.redisUrl });
  redisClient.on('error', (error) => console.error('Redis error:', error.message));
  await redisClient.connect();
  return redisClient;
}

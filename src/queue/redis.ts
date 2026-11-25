import { Redis } from 'ioredis';
import { getEnv } from '../config/env.js';

let redisClient: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!redisClient) {
    const env = getEnv();
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
  }
  return redisClient;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

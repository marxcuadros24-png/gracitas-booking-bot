import { Redis } from 'ioredis';
import { getEnv } from '../config/env.js';
import { getRedisConnection } from './redis.js';

export const BOOKINGS_UPDATED_CHANNEL = 'gracitas:bookings:updated';

export async function publishBookingsUpdated(source: 'whatsapp' | 'admin'): Promise<void> {
  try {
    const redis = getRedisConnection();
    await redis.publish(
      BOOKINGS_UPDATED_CHANNEL,
      JSON.stringify({ type: 'bookings_updated', source, at: Date.now() }),
    );
  } catch (err) {
    console.error('Failed to publish booking event:', err);
  }
}

export function createBookingsSubscriber(onMessage: (payload: string) => void): () => Promise<void> {
  const sub = new Redis(getEnv().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  sub.subscribe(BOOKINGS_UPDATED_CHANNEL).catch((err) => {
    console.error('Redis subscribe failed:', err);
  });

  sub.on('message', (_channel, message) => {
    onMessage(message);
  });

  return async () => {
    await sub.unsubscribe(BOOKINGS_UPDATED_CHANNEL).catch(() => undefined);
    await sub.quit().catch(() => undefined);
  };
}

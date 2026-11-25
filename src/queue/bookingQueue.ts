import { Queue } from 'bullmq';
import { getRedisConnection } from './redis.js';

export const BOOKING_QUEUE_NAME = 'whatsapp-messages';

export interface IncomingWhatsAppJob {
  wamid: string;
  phone: string;
  customerName: string | null;
  text: string;
  receivedAtIso: string;
}

let bookingQueue: Queue<IncomingWhatsAppJob> | null = null;

export function getBookingQueue(): Queue<IncomingWhatsAppJob> {
  if (!bookingQueue) {
    bookingQueue = new Queue<IncomingWhatsAppJob>(BOOKING_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1_000,
        },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    });
  }
  return bookingQueue;
}

export async function closeBookingQueue(): Promise<void> {
  if (bookingQueue) {
    await bookingQueue.close();
    bookingQueue = null;
  }
}

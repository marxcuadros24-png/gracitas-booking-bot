import { Queue } from 'bullmq';
import { getRedisConnection } from './redis.js';

export const BOOKING_REMINDER_QUEUE_NAME = 'booking-reminders';
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export interface ReminderJobPayload {
  bookingId: string;
  phone: string;
  customerName: string;
  resourceName: string;
  startTimeIso: string;
}

let reminderQueue: Queue<ReminderJobPayload> | null = null;

export function getReminderQueue(): Queue<ReminderJobPayload> {
  if (!reminderQueue) {
    reminderQueue = new Queue<ReminderJobPayload>(BOOKING_REMINDER_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5_000,
        },
        removeOnComplete: 1_000,
        removeOnFail: 2_000,
      },
    });
  }
  return reminderQueue;
}

export function calculateReminderDelayMs(
  startTimeIso: string,
  now: Date = new Date(),
): number | null {
  const startMs = new Date(startTimeIso).getTime();
  if (Number.isNaN(startMs)) return null;
  const delayMs = startMs - TWO_HOURS_MS - now.getTime();
  return delayMs > 0 ? delayMs : null;
}

export async function scheduleBookingReminder(payload: ReminderJobPayload): Promise<boolean> {
  const delayMs = calculateReminderDelayMs(payload.startTimeIso);
  if (delayMs === null) {
    return false;
  }

  await getReminderQueue().add('send-reminder', payload, {
    delay: delayMs,
    jobId: `reminder_${payload.bookingId}`,
  });
  return true;
}

export async function closeReminderQueue(): Promise<void> {
  if (reminderQueue) {
    await reminderQueue.close();
    reminderQueue = null;
  }
}

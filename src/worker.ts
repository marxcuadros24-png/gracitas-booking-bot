import { Worker } from 'bullmq';
import OpenAI from 'openai';
import { getEnv } from './config/env.js';
import {
  getRecentMessages,
  saveAssistantMessage,
  upsertChatSessionAndSaveUserMessage,
} from './db/chatRepository.js';
import { closePool, getPool } from './db/pool.js';
import { runLlmTurn } from './llm/orchestrator.js';
import { BOOKING_QUEUE_NAME, type IncomingWhatsAppJob } from './queue/bookingQueue.js';
import { closeRedis, getRedisConnection } from './queue/redis.js';
import {
  BOOKING_REMINDER_QUEUE_NAME,
  closeReminderQueue,
  type ReminderJobPayload,
  scheduleBookingReminder,
} from './queue/reminderQueue.js';
import { listActiveResources, PgBookingRepository } from './tools/bookingRepository.js';
import {
  isWithin24HourWindow,
  sendWhatsAppButtons,
  sendWhatsAppTemplate,
  sendWhatsAppText,
} from './whatsapp/client.js';

const env = getEnv();
const pool = getPool();
const bookingRepo = new PgBookingRepository(pool);
const openai = new OpenAI({
  apiKey: env.LLM_API_KEY,
  baseURL: env.LLM_BASE_URL,
  timeout: 25_000,
  maxRetries: 1,
});

const worker = new Worker<IncomingWhatsAppJob>(
  BOOKING_QUEUE_NAME,
  async (job) => {
    const { wamid, phone, customerName, text } = job.data;

    const { isDuplicate, lastUserMessageAt } = await upsertChatSessionAndSaveUserMessage(pool, {
      phone,
      customerName,
      wamid,
      content: text,
    });

    if (isDuplicate && job.attemptsMade === 0) {
      console.log(`Skipping duplicate wamid=${wamid}`);
      return;
    }

    const [history, resources] = await Promise.all([
      getRecentMessages(pool, phone, 10),
      listActiveResources(pool),
    ]);

    const replyText = await runLlmTurn({
      bookingRepo,
      openai,
      phone,
      customerName,
      history,
      resources,
      onBookingConfirmed: async (booking) => {
        await scheduleBookingReminder({
          bookingId: booking.id,
          phone,
          customerName: booking.customer_name,
          resourceName: booking.resource_name ?? 'Cancha',
          startTimeIso: booking.start_time,
        });
      },
    });

    await saveAssistantMessage(pool, phone, replyText);

    const asksConfirmation =
      /¿.*confirmas|confirma(r)?\s+(tu\s+)?reserva/i.test(replyText) &&
      !/confirmada|exitosamente/i.test(replyText);

    if (asksConfirmation) {
      await sendWhatsAppButtons(
        phone,
        replyText,
        [
          { id: 'confirm_yes', title: 'Sí, confirmar' },
          { id: 'confirm_change', title: 'Cambiar horario' },
        ],
        lastUserMessageAt,
      );
    } else {
      await sendWhatsAppText(phone, replyText, lastUserMessageAt);
    }
  },
  {
    connection: getRedisConnection(),
    concurrency: 5,
  },
);

const reminderWorker = new Worker<ReminderJobPayload>(
  BOOKING_REMINDER_QUEUE_NAME,
  async (job) => {
    const { bookingId, phone, customerName, resourceName, startTimeIso } = job.data;

    const { rows } = await pool.query<{
      status: string;
      reminder_sent_at: Date | null;
      last_user_message_at: Date;
    }>(
      `SELECT b.status, b.reminder_sent_at, cs.last_user_message_at
       FROM bookings b
       JOIN chat_sessions cs ON cs.phone = b.customer_phone
       WHERE b.id = $1`,
      [bookingId],
    );

    if (rows.length === 0 || rows[0].status !== 'confirmed' || rows[0].reminder_sent_at !== null) {
      return;
    }

    const timeLabel = new Intl.DateTimeFormat('es-PE', {
      timeZone: env.APP_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(startTimeIso));

    const { last_user_message_at } = rows[0];

    if (isWithin24HourWindow(last_user_message_at)) {
      await sendWhatsAppText(
        phone,
        `Hola ${customerName}, te recordamos tu partido hoy en **Gracitas** (${resourceName}) a las ${timeLabel}. ¡Te esperamos!`,
        last_user_message_at,
      );
    } else {
      await sendWhatsAppTemplate(
        phone,
        env.WHATSAPP_TEMPLATE_REMINDER_NAME,
        env.WHATSAPP_TEMPLATE_LANGUAGE,
        [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: customerName },
              { type: 'text', text: resourceName },
              { type: 'text', text: timeLabel },
            ],
          },
        ],
      );
    }

    await pool.query(`UPDATE bookings SET reminder_sent_at = NOW() WHERE id = $1`, [bookingId]);
  },
  {
    connection: getRedisConnection(),
    concurrency: 3,
  },
);

reminderWorker.on('failed', (job, err) => {
  console.error(`Reminder job ${job?.id} failed:`, err);
});

function maskPhone(phone: string): string {
  return phone.length > 4 ? `***${phone.slice(-4)}` : '****';
}

worker.on('completed', (job) => {
  console.log(`Processed job ${job.id} for ${maskPhone(job.data.phone)}`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});

async function shutdown() {
  await worker.close();
  await reminderWorker.close();
  await closeReminderQueue();
  await closeRedis();
  await closePool();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

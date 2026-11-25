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
import { listActiveResources, PgBookingRepository } from './tools/bookingRepository.js';
import { sendWhatsAppText } from './whatsapp/client.js';

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
    });

    await saveAssistantMessage(pool, phone, replyText);
    await sendWhatsAppText(phone, replyText, lastUserMessageAt);
  },
  {
    connection: getRedisConnection(),
    concurrency: 5,
  },
);

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
  await closeRedis();
  await closePool();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

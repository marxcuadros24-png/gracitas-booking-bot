import express, { type Request } from 'express';
import { getEnv } from './config/env.js';
import { closePool, getPool } from './db/pool.js';
import { closeBookingQueue } from './queue/bookingQueue.js';
import { closeRedis, getRedisConnection } from './queue/redis.js';
import { createWebhookRouter } from './whatsapp/webhook.js';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    express.json({
      limit: '100kb',
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = buf;
      },
    }),
  );

  app.get('/health', async (_req, res) => {
    try {
      await getPool().query('SELECT 1');
      await getRedisConnection().ping();
      res.status(200).json({ status: 'ok' });
    } catch (err) {
      console.error('Healthcheck failed:', err);
      res.status(503).json({ status: 'unhealthy' });
    }
  });

  app.use('/', createWebhookRouter());

  return app;
}

const env = getEnv();
const app = createApp();
const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`WhatsApp webhook server listening on http://${env.HOST}:${env.PORT}`);
});

async function shutdown() {
  server.close();
  await closeBookingQueue();
  await closeRedis();
  await closePool();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

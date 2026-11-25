import { Router, type Request, type Response } from 'express';
import { getEnv } from '../config/env.js';
import { getBookingQueue } from '../queue/bookingQueue.js';
import { getRedisConnection } from '../queue/redis.js';
import { verifyTokenConstantTime, verifyWhatsAppSignature } from './signature.js';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

interface WhatsAppWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{
          wa_id?: string;
          profile?: { name?: string };
        }>;
        messages?: Array<{
          id?: string;
          from?: string;
          type?: string;
          timestamp?: string;
          text?: { body?: string };
          interactive?: {
            button_reply?: { title?: string };
            list_reply?: { title?: string };
          };
        }>;
      };
    }>;
  }>;
}

const IDEMPOTENCY_TTL_SECONDS = 86_400;

export function createWebhookRouter(): Router {
  const router = Router();

  router.get('/webhook', (req: Request, res: Response) => {
    const env = getEnv();
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (
      mode === 'subscribe' &&
      typeof token === 'string' &&
      verifyTokenConstantTime(token, env.WHATSAPP_VERIFY_TOKEN) &&
      typeof challenge === 'string'
    ) {
      res.status(200).type('text/plain').send(challenge);
      return;
    }

    res.status(403).json({ error: 'Invalid verify token' });
  });

  router.post('/webhook', async (req: RawBodyRequest, res: Response) => {
    const env = getEnv();
    const signature = req.header('x-hub-signature-256');
    const rawBody = req.rawBody;

    if (!rawBody || !verifyWhatsAppSignature(rawBody, signature, env.WHATSAPP_APP_SECRET)) {
      res.status(401).json({ error: 'Invalid X-Hub-Signature-256' });
      return;
    }

    const payload = req.body as WhatsAppWebhookPayload;
    const redis = getRedisConnection();
    const queue = getBookingQueue();

    const enqueuePromises: Promise<unknown>[] = [];

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.messages?.length) continue;

        const contactMap = new Map<string, string>();
        for (const contact of value.contacts ?? []) {
          if (contact.wa_id && contact.profile?.name) {
            contactMap.set(contact.wa_id, contact.profile.name);
          }
        }

        for (const msg of value.messages) {
          const wamid = msg.id;
          const phone = msg.from;
          if (!wamid || !phone) continue;

          const text =
            msg.text?.body ??
            msg.interactive?.button_reply?.title ??
            msg.interactive?.list_reply?.title;

          if (!text) continue;

          enqueuePromises.push(
            (async () => {
              const isNew = await redis.set(
                `idemp:wamid:${wamid}`,
                '1',
                'EX',
                IDEMPOTENCY_TTL_SECONDS,
                'NX',
              );
              if (!isNew) {
                return;
              }

              await queue.add(
                'process-message',
                {
                  wamid,
                  phone,
                  customerName: contactMap.get(phone) ?? null,
                  text,
                  receivedAtIso: new Date().toISOString(),
                },
                {
                  jobId: wamid.replace(/[:]/g, '_'),
                },
              );
            })(),
          );
        }
      }
    }

    await Promise.all(enqueuePromises);
    res.status(200).json({ status: 'ok' });
  });

  return router;
}

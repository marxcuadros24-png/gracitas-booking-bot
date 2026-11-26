import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  APP_TIMEZONE: z.string().default('America/Lima'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  WHATSAPP_TEMPLATE_REMINDER_NAME: z.string().default('booking_reminder'),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default('es'),

  LLM_API_KEY: z.string().min(1),
  LLM_BASE_URL: z.string().default('https://api.openai.com/v1'),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
  LLM_MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(10).default(3),

  ADMIN_TOKEN: z.string().min(1).default('gracitas-admin-2026'),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env);
  }
  return cachedEnv;
}

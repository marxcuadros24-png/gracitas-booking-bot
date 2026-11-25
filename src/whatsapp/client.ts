import { getEnv } from '../config/env.js';
import { isWithin24HourWindow, WhatsAppWindowExpiredError } from '../domain/booking.js';

export { isWithin24HourWindow, WhatsAppWindowExpiredError };

async function postToWhatsAppApi(payload: Record<string, unknown>): Promise<void> {
  const env = getEnv();
  const url = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WhatsApp API error (${response.status}): ${errorText}`);
  }
}

export async function sendWhatsAppText(
  to: string,
  body: string,
  lastUserMessageAt: Date,
): Promise<void> {
  if (!isWithin24HourWindow(lastUserMessageAt)) {
    throw new WhatsAppWindowExpiredError(to);
  }

  await postToWhatsAppApi({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      preview_url: false,
      body,
    },
  });
}

export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  components: unknown[] = [],
): Promise<void> {
  await postToWhatsAppApi({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length > 0 ? { components } : {}),
    },
  });
}

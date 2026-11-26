import { getEnv } from '../config/env.js';
import { isWithin24HourWindow, WhatsAppWindowExpiredError } from '../domain/booking.js';

export { isWithin24HourWindow, WhatsAppWindowExpiredError };

export interface InteractiveButton {
  id: string;
  title: string;
}

export interface InteractiveListRow {
  id: string;
  title: string;
  description?: string;
}

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

export async function sendWhatsAppButtons(
  to: string,
  bodyText: string,
  buttons: InteractiveButton[],
  lastUserMessageAt: Date,
): Promise<void> {
  if (!isWithin24HourWindow(lastUserMessageAt)) {
    throw new WhatsAppWindowExpiredError(to);
  }

  await postToWhatsAppApi({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText.slice(0, 1024) },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: 'reply',
          reply: {
            id: b.id.slice(0, 256),
            title: b.title.slice(0, 20),
          },
        })),
      },
    },
  });
}

export async function sendWhatsAppList(
  to: string,
  bodyText: string,
  buttonLabel: string,
  rows: InteractiveListRow[],
  lastUserMessageAt: Date,
): Promise<void> {
  if (!isWithin24HourWindow(lastUserMessageAt)) {
    throw new WhatsAppWindowExpiredError(to);
  }

  await postToWhatsAppApi({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText.slice(0, 1024) },
      action: {
        button: buttonLabel.slice(0, 20),
        sections: [
          {
            title: 'Opciones disponibles',
            rows: rows.slice(0, 10).map((r) => ({
              id: r.id.slice(0, 200),
              title: r.title.slice(0, 24),
              ...(r.description ? { description: r.description.slice(0, 72) } : {}),
            })),
          },
        ],
      },
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

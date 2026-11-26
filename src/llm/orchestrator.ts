import OpenAI from 'openai';
import { getEnv } from '../config/env.js';
import type { StoredChatMessage } from '../db/chatRepository.js';
import type {
  BookingRepository,
  CreateBookingResult,
  ResourceSummary,
} from '../domain/booking.js';
import { BOOKING_TOOLS, executeBookingTool } from '../tools/definitions.js';
import { buildSystemPrompt } from './prompt.js';

export interface OrchestratorInput {
  bookingRepo: BookingRepository;
  openai: OpenAI;
  phone: string;
  customerName: string | null;
  history: StoredChatMessage[];
  resources: ResourceSummary[];
  maxIterations?: number;
  now?: Date;
  onBookingConfirmed?: (booking: NonNullable<CreateBookingResult['booking']>) => Promise<void>;
}

export async function runLlmTurn(input: OrchestratorInput): Promise<string> {
  const env = getEnv();
  const maxIterations = input.maxIterations ?? env.LLM_MAX_TOOL_ITERATIONS;

  const systemPrompt = buildSystemPrompt({
    now: input.now ?? new Date(),
    timeZone: env.APP_TIMEZONE,
    userPhone: input.phone,
    customerName: input.customerName,
    resources: input.resources,
  });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...input.history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const completion = await input.openai.chat.completions.create({
      model: env.LLM_MODEL,
      messages,
      tools: BOOKING_TOOLS,
      tool_choice: 'auto',
      temperature: 0.2,
    });

    const choice = completion.choices[0]?.message;
    if (!choice) {
      break;
    }

    if (!choice.tool_calls || choice.tool_calls.length === 0) {
      return choice.content?.trim() || 'Lo siento, no pude generar una respuesta en este momento.';
    }

    messages.push({
      role: 'assistant',
      content: choice.content ?? null,
      tool_calls: choice.tool_calls,
    });

    for (const toolCall of choice.tool_calls) {
      if (toolCall.type !== 'function') continue;

      console.log(`[LLM] Calling tool ${toolCall.function.name}`);
      const toolOutput = await executeBookingTool(
        input.bookingRepo,
        input.phone,
        toolCall.function.name,
        toolCall.function.arguments,
      );
      console.log(`[LLM] Tool ${toolCall.function.name} completed`);

      if (toolCall.function.name === 'create_booking' && input.onBookingConfirmed) {
        try {
          const parsed = JSON.parse(toolOutput) as CreateBookingResult;
          if (parsed.status === 'confirmed' && parsed.booking) {
            await input.onBookingConfirmed(parsed.booking);
          }
        } catch {
          // Ignore callback parsing errors
        }
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolOutput,
      });
    }
  }

  // Final pass without tools if maxIterations was reached while calling tools
  const finalCompletion = await input.openai.chat.completions.create({
    model: env.LLM_MODEL,
    messages,
    tool_choice: 'none',
    temperature: 0.2,
  });

  return (
    finalCompletion.choices[0]?.message?.content?.trim() ||
    'Disculpa, tuve un inconveniente procesando tu solicitud. ¿Podrías intentarlo de nuevo?'
  );
}

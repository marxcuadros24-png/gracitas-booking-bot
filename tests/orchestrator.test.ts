import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import type { BookingRepository } from '../src/domain/booking.js';
import { runLlmTurn } from '../src/llm/orchestrator.js';
import { executeBookingTool } from '../src/tools/definitions.js';

process.env.DATABASE_URL ??= 'postgresql://booking_user:booking_pass@localhost:5432/booking_db';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.WHATSAPP_VERIFY_TOKEN ??= 'test-verify';
process.env.WHATSAPP_APP_SECRET ??= 'test-secret';
process.env.WHATSAPP_ACCESS_TOKEN ??= 'test-token';
process.env.WHATSAPP_PHONE_NUMBER_ID ??= '123456';
process.env.LLM_API_KEY ??= 'test-key';

describe('runLlmTurn', () => {
  it('injects America/Lima time and caps tool iterations at 3', async () => {
    const createMock = vi
      .fn()
      // Iterations 1..3 always request a tool call
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'get_user_bookings', arguments: '{"phone":"51999888777"}' },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_2',
                  type: 'function',
                  function: { name: 'get_user_bookings', arguments: '{"phone":"51999888777"}' },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_3',
                  type: 'function',
                  function: { name: 'get_user_bookings', arguments: '{"phone":"51999888777"}' },
                },
              ],
            },
          },
        ],
      })
      // Final forced text response with tool_choice: 'none'
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'No tienes reservas activas.' } }],
      });

    const mockOpenAI = {
      chat: { completions: { create: createMock } },
    } as unknown as OpenAI;

    const mockRepo: BookingRepository = {
      checkAvailability: vi.fn(),
      createBooking: vi.fn(),
      getUserBookings: vi.fn().mockResolvedValue([]),
      cancelBooking: vi.fn(),
    };

    const reply = await runLlmTurn({
      bookingRepo: mockRepo,
      openai: mockOpenAI,
      phone: '51999888777',
      customerName: 'Ana',
      history: [{ role: 'user', content: 'Mis reservas' }],
      resources: [],
      maxIterations: 3,
      now: new Date('2026-11-25T19:00:00Z'),
    });

    expect(reply).toBe('No tienes reservas activas.');
    expect(createMock).toHaveBeenCalledTimes(4);

    const firstCallMessages = createMock.mock.calls[0][0].messages;
    expect(firstCallMessages[0].role).toBe('system');
    expect(firstCallMessages[0].content).toContain('America/Lima');
    expect(firstCallMessages[0].content).toContain('confirmación explícita');
    expect(firstCallMessages[0].content).toContain('Gracitas');
    expect(firstCallMessages[0].content).toContain('BLOQUEO DE TEMAS AJENOS');
    expect(createMock.mock.calls[3][0].tool_choice).toBe('none');
  });

  it('enforces sessionPhone and ignores spoofed phone in tool arguments', async () => {
    const getUserBookingsMock = vi.fn().mockResolvedValue([]);
    const mockRepo: BookingRepository = {
      checkAvailability: vi.fn(),
      createBooking: vi.fn(),
      getUserBookings: getUserBookingsMock,
      cancelBooking: vi.fn(),
    };

    const resultJson = await executeBookingTool(
      mockRepo,
      '51999593783',
      'get_user_bookings',
      JSON.stringify({ phone: '51000000000' }),
    );

    const parsed = JSON.parse(resultJson) as { status: string; phone: string };
    expect(parsed.status).toBe('ok');
    expect(parsed.phone).toBe('51999593783');
    expect(getUserBookingsMock).toHaveBeenCalledWith('51999593783');
  });
});

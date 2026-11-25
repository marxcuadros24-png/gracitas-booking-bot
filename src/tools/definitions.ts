import type OpenAI from 'openai';
import { z } from 'zod';
import type { BookingRepository } from '../domain/booking.js';

export const BOOKING_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: 'Consulta los horarios libres reales en PostgreSQL para un recurso y una fecha específica.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          resource_id: {
            type: 'string',
            description: 'UUID del recurso (cancha, consultorio o servicio).',
          },
          date: {
            type: 'string',
            description: 'Fecha en formato YYYY-MM-DD en zona horaria America/Lima.',
          },
        },
        required: ['resource_id', 'date'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_booking',
      description:
        'Crea una reserva confirmada dentro de una transacción. Solo debe llamarse después de que el usuario confirme explícitamente.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          resource_id: {
            type: 'string',
            description: 'UUID del recurso a reservar.',
          },
          start_time: {
            type: 'string',
            description: 'Fecha/hora de inicio en formato ISO 8601 con offset (ej. 2026-11-26T19:00:00-05:00).',
          },
          end_time: {
            type: 'string',
            description: 'Fecha/hora de fin en formato ISO 8601 con offset (ej. 2026-11-26T20:00:00-05:00).',
          },
          customer_name: {
            type: 'string',
            description: 'Nombre del cliente que realiza la reserva.',
          },
        },
        required: ['resource_id', 'start_time', 'end_time', 'customer_name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_user_bookings',
      description: 'Lista las reservas activas y futuras del número de teléfono del usuario.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          phone: {
            type: 'string',
            description: 'Número de teléfono del usuario en formato internacional (sin +).',
          },
        },
        required: ['phone'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_booking',
      description: 'Cancela una reserva activa validando que pertenezca al número de teléfono del titular.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          booking_id: {
            type: 'string',
            description: 'UUID de la reserva a cancelar.',
          },
          phone: {
            type: 'string',
            description: 'Número de teléfono del titular de la reserva.',
          },
        },
        required: ['booking_id', 'phone'],
        additionalProperties: false,
      },
    },
  },
];

const checkAvailabilitySchema = z.object({
  resource_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const createBookingSchema = z.object({
  resource_id: z.string().uuid(),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  customer_name: z.string().trim().min(1).max(120),
});

const getUserBookingsSchema = z.object({
  phone: z.string().min(5),
});

const cancelBookingSchema = z.object({
  booking_id: z.string().uuid(),
  phone: z.string().min(5),
});

export async function executeBookingTool(
  bookingRepo: BookingRepository,
  sessionPhone: string,
  toolName: string,
  rawArgs: string,
): Promise<string> {
  try {
    const parsed = JSON.parse(rawArgs) as unknown;

    switch (toolName) {
      case 'check_availability': {
        const args = checkAvailabilitySchema.parse(parsed);
        const result = await bookingRepo.checkAvailability(args.resource_id, args.date);
        return JSON.stringify(result);
      }
      case 'create_booking': {
        const args = createBookingSchema.parse(parsed);
        const result = await bookingRepo.createBooking({
          resourceId: args.resource_id,
          startTime: args.start_time,
          endTime: args.end_time,
          customerName: args.customer_name,
          customerPhone: sessionPhone,
        });
        return JSON.stringify(result);
      }
      case 'get_user_bookings': {
        getUserBookingsSchema.parse(parsed);
        const bookings = await bookingRepo.getUserBookings(sessionPhone);
        return JSON.stringify({ status: 'ok', phone: sessionPhone, bookings });
      }
      case 'cancel_booking': {
        const args = cancelBookingSchema.parse(parsed);
        const result = await bookingRepo.cancelBooking(args.booking_id, sessionPhone);
        return JSON.stringify(result);
      }
      default:
        return JSON.stringify({ status: 'error', message: `Herramienta desconocida: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({
      status: 'error',
      message: err instanceof Error ? err.message : 'Error ejecutando la herramienta',
    });
  }
}

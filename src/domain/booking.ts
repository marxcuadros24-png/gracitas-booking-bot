export const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export class WhatsAppWindowExpiredError extends Error {
  constructor(phone: string) {
    super(
      `La ventana de 24 horas de WhatsApp expiró para ${phone}. Usa sendWhatsAppTemplate para enviar un Message Template aprobado.`,
    );
    this.name = 'WhatsAppWindowExpiredError';
  }
}

export function isWithin24HourWindow(lastUserMessageAt: Date, now: Date = new Date()): boolean {
  const elapsedMs = now.getTime() - lastUserMessageAt.getTime();
  return elapsedMs >= 0 && elapsedMs < TWENTY_FOUR_HOURS_MS;
}

export interface ResourceSummary {
  id: string;
  name: string;
  type: string;
  description: string | null;
  slot_duration_minutes: number;
  open_hour: number;
  close_hour: number;
  price_per_hour: string;
  evening_start_hour: number | null;
  evening_price_per_hour: string | null;
}

export interface AvailableSlot {
  start_time: string;
  end_time: string;
  label: string;
  price: number;
}

export interface CheckAvailabilityResult {
  status: 'ok' | 'resource_not_found' | 'invalid_input';
  resource_id: string;
  resource_name?: string;
  date: string;
  duration_hours?: number;
  timezone: string;
  available_slots: AvailableSlot[];
}

export interface CreateBookingInput {
  resourceId: string;
  startTime: string;
  endTime: string;
  customerName: string;
  customerPhone: string;
}

export interface CreateBookingResult {
  status: 'confirmed' | 'conflict' | 'invalid_input' | 'resource_not_found';
  booking?: {
    id: string;
    resource_id: string;
    resource_name?: string;
    customer_name: string;
    start_time: string;
    end_time: string;
    total_price: number;
    status: string;
  };
  message?: string;
  alternatives?: AvailableSlot[];
}

export interface UserBookingItem {
  booking_id: string;
  resource_id: string;
  resource_name: string;
  customer_name: string;
  start_time: string;
  end_time: string;
  total_price: number;
  status: string;
}

export interface CancelBookingResult {
  status: 'cancelled' | 'not_found_or_unauthorized';
  booking_id: string;
  message: string;
}

export interface BookingRepository {
  checkAvailability(
    resourceId: string,
    date: string,
    durationHours?: number,
  ): Promise<CheckAvailabilityResult>;
  createBooking(params: CreateBookingInput): Promise<CreateBookingResult>;
  getUserBookings(phone: string): Promise<UserBookingItem[]>;
  cancelBooking(bookingId: string, phone: string): Promise<CancelBookingResult>;
}

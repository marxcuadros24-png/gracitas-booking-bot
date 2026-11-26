import type { Pool } from 'pg';
import { getEnv } from '../config/env.js';
import type {
  AvailableSlot,
  BookingRepository,
  CancelBookingResult,
  CheckAvailabilityResult,
  CreateBookingInput,
  CreateBookingResult,
  ResourceSummary,
  UserBookingItem,
} from '../domain/booking.js';

export type {
  AvailableSlot,
  BookingRepository,
  CancelBookingResult,
  CheckAvailabilityResult,
  CreateBookingInput,
  CreateBookingResult,
  ResourceSummary,
  UserBookingItem,
};

export class PgBookingRepository implements BookingRepository {
  constructor(private readonly pool: Pool) {}

  checkAvailability(
    resourceId: string,
    date: string,
    durationHours = 1,
  ): Promise<CheckAvailabilityResult> {
    return checkAvailability(this.pool, resourceId, date, durationHours);
  }

  createBooking(params: CreateBookingInput): Promise<CreateBookingResult> {
    return createBooking(this.pool, params);
  }

  getUserBookings(phone: string): Promise<UserBookingItem[]> {
    return getUserBookings(this.pool, phone);
  }

  cancelBooking(bookingId: string, phone: string): Promise<CancelBookingResult> {
    return cancelBooking(this.pool, bookingId, phone);
  }
}

interface PgError extends Error {
  code?: string;
}

function formatLimaLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function formatLimaDate(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function getLimaHour(date: Date, timeZone: string): number {
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(date);
  return Number(hourStr) % 24;
}

export function calculateRangePrice(
  resource: Pick<ResourceSummary, 'price_per_hour' | 'evening_start_hour' | 'evening_price_per_hour'>,
  start: Date,
  end: Date,
  timeZone: string,
): number {
  const baseRate = Number(resource.price_per_hour);
  const eveningStart = resource.evening_start_hour;
  const eveningRate =
    resource.evening_price_per_hour !== null ? Number(resource.evening_price_per_hour) : null;

  const totalMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (totalMinutes <= 0) return 0;

  // Step in 60-minute chunks (or proportional remainder)
  let total = 0;
  let cursorMs = start.getTime();
  const endMs = end.getTime();

  while (cursorMs < endMs) {
    const chunkEndMs = Math.min(cursorMs + 60 * 60_000, endMs);
    const fraction = (chunkEndMs - cursorMs) / (60 * 60_000);
    const hour = getLimaHour(new Date(cursorMs), timeZone);
    const rate =
      eveningStart !== null && eveningRate !== null && hour >= eveningStart
        ? eveningRate
        : baseRate;
    total += rate * fraction;
    cursorMs = chunkEndMs;
  }

  return Math.round(total * 100) / 100;
}

export async function listActiveResources(pool: Pool): Promise<ResourceSummary[]> {
  const { rows } = await pool.query<ResourceSummary>(
    `SELECT id, name, type, description, slot_duration_minutes, open_hour, close_hour,
            price_per_hour, evening_start_hour, evening_price_per_hour
     FROM resources
     WHERE is_active = true
     ORDER BY name ASC`,
  );
  return rows;
}

export async function checkAvailability(
  pool: Pool,
  resourceId: string,
  date: string,
  durationHours = 1,
): Promise<CheckAvailabilityResult> {
  const tz = getEnv().APP_TIMEZONE;

  if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 4) {
    return {
      status: 'invalid_input',
      resource_id: resourceId,
      date,
      duration_hours: durationHours,
      timezone: tz,
      available_slots: [],
    };
  }

  const resourceRes = await pool.query<ResourceSummary>(
    `SELECT id, name, type, description, slot_duration_minutes, open_hour, close_hour,
            price_per_hour, evening_start_hour, evening_price_per_hour
     FROM resources
     WHERE id = $1 AND is_active = true`,
    [resourceId],
  );

  if (resourceRes.rowCount === 0) {
    return {
      status: 'resource_not_found',
      resource_id: resourceId,
      date,
      duration_hours: durationHours,
      timezone: tz,
      available_slots: [],
    };
  }

  const resource = resourceRes.rows[0];
  const blockMinutes = resource.slot_duration_minutes * durationHours;

  const slotsRes = await pool.query<{
    slot_start: Date;
    slot_end: Date;
  }>(
    `WITH bounds AS (
       SELECT
         (($1::date + make_interval(hours => $2)) AT TIME ZONE $4) AS day_start,
         (($1::date + make_interval(hours => $3)) AT TIME ZONE $4) AS day_end
     ),
     candidate_slots AS (
       SELECT
         gs AS slot_start,
         gs + make_interval(mins => $7) AS slot_end
       FROM bounds,
       LATERAL generate_series(
         bounds.day_start,
         bounds.day_end - make_interval(mins => $7),
         make_interval(mins => $5)
       ) AS gs
     )
     SELECT cs.slot_start, cs.slot_end
     FROM candidate_slots cs
     WHERE cs.slot_end > NOW()
       AND NOT EXISTS (
         SELECT 1
         FROM bookings b
         WHERE b.resource_id = $6
           AND b.status = 'confirmed'
           AND b.time_range && tstzrange(cs.slot_start, cs.slot_end, '[)')
       )
     ORDER BY cs.slot_start ASC`,
    [
      date,
      resource.open_hour,
      resource.close_hour,
      tz,
      resource.slot_duration_minutes,
      resourceId,
      blockMinutes,
    ],
  );

  const available_slots: AvailableSlot[] = slotsRes.rows.map((row) => {
    const startIso = row.slot_start.toISOString();
    const endIso = row.slot_end.toISOString();
    return {
      start_time: startIso,
      end_time: endIso,
      label: `${formatLimaLabel(startIso, tz)} - ${formatLimaLabel(endIso, tz)}`,
      price: calculateRangePrice(resource, row.slot_start, row.slot_end, tz),
    };
  });

  return {
    status: 'ok',
    resource_id: resource.id,
    resource_name: resource.name,
    date,
    duration_hours: durationHours,
    timezone: tz,
    available_slots,
  };
}

export async function createBooking(
  pool: Pool,
  params: CreateBookingInput,
): Promise<CreateBookingResult> {
  const start = new Date(params.startTime);
  const end = new Date(params.endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return {
      status: 'invalid_input',
      message: 'Rango horario inválido: start_time debe ser anterior a end_time.',
    };
  }

  if (end.getTime() <= Date.now()) {
    return {
      status: 'invalid_input',
      message: 'No se puede reservar un horario en el pasado.',
    };
  }

  const tz = getEnv().APP_TIMEZONE;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const resCheck = await client.query<ResourceSummary>(
      `SELECT id, name, type, description, slot_duration_minutes, open_hour, close_hour,
              price_per_hour, evening_start_hour, evening_price_per_hour
       FROM resources
       WHERE id = $1 AND is_active = true`,
      [params.resourceId],
    );
    if (resCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return {
        status: 'resource_not_found',
        message: 'La cancha especificada no existe o está inactiva.',
      };
    }

    const resource = resCheck.rows[0];
    const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
    if (durationMinutes < resource.slot_duration_minutes || durationMinutes % resource.slot_duration_minutes !== 0) {
      await client.query('ROLLBACK');
      return {
        status: 'invalid_input',
        message: `La duración debe ser múltiplo de ${resource.slot_duration_minutes} minutos.`,
      };
    }

    const totalPrice = calculateRangePrice(resource, start, end, tz);

    const insertRes = await client.query<{
      id: string;
      resource_id: string;
      customer_name: string;
      start_time: Date;
      end_time: Date;
      total_price: string;
      status: string;
    }>(
      `INSERT INTO bookings (resource_id, customer_phone, customer_name, time_range, total_price, status)
       VALUES ($1, $2, $3, tstzrange($4::timestamptz, $5::timestamptz, '[)'), $6, 'confirmed')
       RETURNING id, resource_id, customer_name, lower(time_range) AS start_time, upper(time_range) AS end_time, total_price, status`,
      [
        params.resourceId,
        params.customerPhone,
        params.customerName,
        start.toISOString(),
        end.toISOString(),
        totalPrice,
      ],
    );

    await client.query('COMMIT');

    const row = insertRes.rows[0];
    return {
      status: 'confirmed',
      booking: {
        id: row.id,
        resource_id: row.resource_id,
        resource_name: resource.name,
        customer_name: row.customer_name,
        start_time: row.start_time.toISOString(),
        end_time: row.end_time.toISOString(),
        total_price: Number(row.total_price),
        status: row.status,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    const pgErr = err as PgError;

    // 23P01 = exclusion_violation from GiST constraint bookings_no_overlap
    if (pgErr.code === '23P01') {
      const dateStr = formatLimaDate(start.toISOString(), tz);
      const durationHours = Math.max(1, Math.round((end.getTime() - start.getTime()) / 3_600_000));
      const availability = await checkAvailability(pool, params.resourceId, dateStr, Math.min(durationHours, 4));
      return {
        status: 'conflict',
        message: 'El horario solicitado acaba de ser ocupado por otro cliente.',
        alternatives: availability.available_slots.slice(0, 5),
      };
    }

    throw err;
  } finally {
    client.release();
  }
}

export async function getUserBookings(pool: Pool, phone: string): Promise<UserBookingItem[]> {
  const { rows } = await pool.query<{
    booking_id: string;
    resource_id: string;
    resource_name: string;
    customer_name: string;
    start_time: Date;
    end_time: Date;
    total_price: string;
    status: string;
  }>(
    `SELECT
       b.id AS booking_id,
       b.resource_id,
       r.name AS resource_name,
       b.customer_name,
       lower(b.time_range) AS start_time,
       upper(b.time_range) AS end_time,
       b.total_price,
       b.status
     FROM bookings b
     JOIN resources r ON r.id = b.resource_id
     WHERE b.customer_phone = $1
       AND b.status = 'confirmed'
       AND upper(b.time_range) > NOW()
     ORDER BY lower(b.time_range) ASC`,
    [phone],
  );

  return rows.map((row) => ({
    booking_id: row.booking_id,
    resource_id: row.resource_id,
    resource_name: row.resource_name,
    customer_name: row.customer_name,
    start_time: row.start_time.toISOString(),
    end_time: row.end_time.toISOString(),
    total_price: Number(row.total_price),
    status: row.status,
  }));
}

export async function cancelBooking(
  pool: Pool,
  bookingId: string,
  phone: string,
): Promise<CancelBookingResult> {
  const { rowCount } = await pool.query(
    `UPDATE bookings
     SET status = 'cancelled', cancelled_at = NOW()
     WHERE id = $1
       AND customer_phone = $2
       AND status = 'confirmed'`,
    [bookingId, phone],
  );

  if (!rowCount) {
    return {
      status: 'not_found_or_unauthorized',
      booking_id: bookingId,
      message: 'No se encontró una reserva activa con ese ID asociada a tu número.',
    };
  }

  return {
    status: 'cancelled',
    booking_id: bookingId,
    message: 'Reserva cancelada exitosamente.',
  };
}

export interface AdminBookingItem {
  id: string;
  resource_id: string;
  resource_name: string;
  customer_name: string;
  customer_phone: string;
  start_time: string;
  end_time: string;
  total_price: number;
  status: string;
}

export async function getAdminBookingsByDate(pool: Pool, date: string): Promise<AdminBookingItem[]> {
  const tz = getEnv().APP_TIMEZONE;
  const { rows } = await pool.query<{
    id: string;
    resource_id: string;
    resource_name: string;
    customer_name: string;
    customer_phone: string;
    start_time: Date;
    end_time: Date;
    total_price: string;
    status: string;
  }>(
    `SELECT
       b.id,
       b.resource_id,
       r.name AS resource_name,
       b.customer_name,
       b.customer_phone,
       lower(b.time_range) AS start_time,
       upper(b.time_range) AS end_time,
       b.total_price,
       b.status
     FROM bookings b
     JOIN resources r ON r.id = b.resource_id
     WHERE b.time_range && tstzrange(
       ($1::date AT TIME ZONE $2),
       (($1::date + 1) AT TIME ZONE $2),
       '[)'
     )
     ORDER BY lower(b.time_range) ASC, r.name ASC`,
    [date, tz],
  );

  return rows.map((row) => ({
    id: row.id,
    resource_id: row.resource_id,
    resource_name: row.resource_name,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    start_time: row.start_time.toISOString(),
    end_time: row.end_time.toISOString(),
    total_price: Number(row.total_price),
    status: row.status,
  }));
}

export async function adminCancelBooking(pool: Pool, bookingId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE bookings
     SET status = 'cancelled', cancelled_at = NOW()
     WHERE id = $1 AND status = 'confirmed'`,
    [bookingId],
  );
  return (rowCount ?? 0) > 0;
}

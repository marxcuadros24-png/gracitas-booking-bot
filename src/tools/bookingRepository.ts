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

  checkAvailability(resourceId: string, date: string): Promise<CheckAvailabilityResult> {
    return checkAvailability(this.pool, resourceId, date);
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

export async function listActiveResources(pool: Pool): Promise<ResourceSummary[]> {
  const { rows } = await pool.query<ResourceSummary>(
    `SELECT id, name, type, description, slot_duration_minutes, open_hour, close_hour, price_per_hour
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
): Promise<CheckAvailabilityResult> {
  const tz = getEnv().APP_TIMEZONE;

  const resourceRes = await pool.query<ResourceSummary>(
    `SELECT id, name, type, description, slot_duration_minutes, open_hour, close_hour
     FROM resources
     WHERE id = $1 AND is_active = true`,
    [resourceId],
  );

  if (resourceRes.rowCount === 0) {
    return {
      status: 'resource_not_found',
      resource_id: resourceId,
      date,
      timezone: tz,
      available_slots: [],
    };
  }

  const resource = resourceRes.rows[0];

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
         gs + make_interval(mins => $5) AS slot_end
       FROM bounds,
       LATERAL generate_series(
         bounds.day_start,
         bounds.day_end - make_interval(mins => $5),
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
    [date, resource.open_hour, resource.close_hour, tz, resource.slot_duration_minutes, resourceId],
  );

  const available_slots: AvailableSlot[] = slotsRes.rows.map((row) => {
    const startIso = row.slot_start.toISOString();
    const endIso = row.slot_end.toISOString();
    return {
      start_time: startIso,
      end_time: endIso,
      label: `${formatLimaLabel(startIso, tz)} - ${formatLimaLabel(endIso, tz)}`,
    };
  });

  return {
    status: 'ok',
    resource_id: resource.id,
    resource_name: resource.name,
    date,
    timezone: tz,
    available_slots,
  };
}

export async function createBooking(
  pool: Pool,
  params: {
    resourceId: string;
    startTime: string;
    endTime: string;
    customerName: string;
    customerPhone: string;
  },
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const resCheck = await client.query('SELECT id FROM resources WHERE id = $1 AND is_active = true', [
      params.resourceId,
    ]);
    if (resCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return {
        status: 'resource_not_found',
        message: 'El recurso especificado no existe o está inactivo.',
      };
    }

    const insertRes = await client.query<{
      id: string;
      resource_id: string;
      customer_name: string;
      start_time: Date;
      end_time: Date;
      status: string;
    }>(
      `INSERT INTO bookings (resource_id, customer_phone, customer_name, time_range, status)
       VALUES ($1, $2, $3, tstzrange($4::timestamptz, $5::timestamptz, '[)'), 'confirmed')
       RETURNING id, resource_id, customer_name, lower(time_range) AS start_time, upper(time_range) AS end_time, status`,
      [params.resourceId, params.customerPhone, params.customerName, start.toISOString(), end.toISOString()],
    );

    await client.query('COMMIT');

    const row = insertRes.rows[0];
    return {
      status: 'confirmed',
      booking: {
        id: row.id,
        resource_id: row.resource_id,
        customer_name: row.customer_name,
        start_time: row.start_time.toISOString(),
        end_time: row.end_time.toISOString(),
        status: row.status,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    const pgErr = err as PgError;

    // 23P01 = exclusion_violation from GiST constraint bookings_no_overlap
    if (pgErr.code === '23P01') {
      const tz = getEnv().APP_TIMEZONE;
      const dateStr = formatLimaDate(start.toISOString(), tz);
      const availability = await checkAvailability(pool, params.resourceId, dateStr);
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
    status: string;
  }>(
    `SELECT
       b.id AS booking_id,
       b.resource_id,
       r.name AS resource_name,
       b.customer_name,
       lower(b.time_range) AS start_time,
       upper(b.time_range) AS end_time,
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

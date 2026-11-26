import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  cancelBooking,
  createBooking,
  getUserBookings,
  listActiveResources,
} from '../src/tools/bookingRepository.js';

const runIntegration = Boolean(process.env.RUN_PG_INTEGRATION);

describe.skipIf(!runIntegration)('PostgreSQL GiST overlap lock integration', () => {
  beforeAll(async () => {
    await runMigrations();
    const pool = getPool();
    await pool.query(
      `DELETE FROM bookings WHERE customer_phone IN ('51900000001', '51900000002')`,
    );
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(
      `DELETE FROM bookings WHERE customer_phone IN ('51900000001', '51900000002')`,
    );
    await closePool();
  });

  it('rejects concurrent overlapping bookings with conflict + alternatives', async () => {
    const pool = getPool();
    const resources = await listActiveResources(pool);
    expect(resources.length).toBeGreaterThan(0);
    const resourceId = resources[0].id;

    // Isolated future 2-hour slot in America/Lima (19:00 - 21:00)
    const startIso = '2030-05-15T19:00:00-05:00';
    const endIso = '2030-05-15T21:00:00-05:00';

    const [r1, r2] = await Promise.all([
      createBooking(pool, {
        resourceId,
        startTime: startIso,
        endTime: endIso,
        customerName: 'Cliente Uno',
        customerPhone: '51900000001',
      }),
      createBooking(pool, {
        resourceId,
        startTime: startIso,
        endTime: endIso,
        customerName: 'Cliente Dos',
        customerPhone: '51900000002',
      }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual(['confirmed', 'conflict']);

    const conflictResult = r1.status === 'conflict' ? r1 : r2;
    const confirmedResult = r1.status === 'confirmed' ? r1 : r2;

    expect(conflictResult.alternatives?.length).toBeGreaterThan(0);
    expect(confirmedResult.booking?.id).toBeDefined();
    expect(confirmedResult.booking?.total_price).toBe(80);

    const bookingId = confirmedResult.booking!.id;
    const ownerPhone =
      r1.status === 'confirmed' ? '51900000001' : '51900000002';
    const otherPhone =
      r1.status === 'confirmed' ? '51900000002' : '51900000001';

    // Unauthorized cancellation must fail
    const wrongCancel = await cancelBooking(pool, bookingId, otherPhone);
    expect(wrongCancel.status).toBe('not_found_or_unauthorized');

    // Owner cancellation succeeds
    const ownerBookings = await getUserBookings(pool, ownerPhone);
    expect(ownerBookings.some((b) => b.booking_id === bookingId)).toBe(true);

    const okCancel = await cancelBooking(pool, bookingId, ownerPhone);
    expect(okCancel.status).toBe('cancelled');
  });
});

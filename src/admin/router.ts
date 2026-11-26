import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { getPool } from '../db/pool.js';
import { scheduleBookingReminder } from '../queue/reminderQueue.js';
import {
  adminCancelBooking,
  createBooking,
  getAdminBookingsByDate,
  listActiveResources,
} from '../tools/bookingRepository.js';
import { verifyTokenConstantTime } from '../whatsapp/signature.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const createAdminBookingSchema = z.object({
  resourceId: z.string().uuid(),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  customerName: z.string().trim().min(1).max(120),
  customerPhone: z.string().trim().min(5).max(30),
});

function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.header('x-admin-token') ?? '';
  const expected = getEnv().ADMIN_TOKEN;
  if (!verifyTokenConstantTime(token, expected)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

export function createAdminRouter(): Router {
  const router = Router();

  router.get('/admin', async (_req: Request, res: Response) => {
    const html = await readFile(join(__dirname, 'dashboard.html'), 'utf-8');
    res.status(200).type('text/html; charset=utf-8').send(html);
  });

  router.get('/admin/api/overview', requireAdminAuth, async (req: Request, res: Response) => {
    const dateParam = typeof req.query.date === 'string' ? req.query.date : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      res.status(400).json({ error: 'Parámetro date inválido (YYYY-MM-DD)' });
      return;
    }

    const pool = getPool();
    const [resources, bookings] = await Promise.all([
      listActiveResources(pool),
      getAdminBookingsByDate(pool, dateParam),
    ]);

    res.status(200).json({ date: dateParam, resources, bookings });
  });

  router.post('/admin/api/bookings', requireAdminAuth, async (req: Request, res: Response) => {
    const parsed = createAdminBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const pool = getPool();
    const result = await createBooking(pool, parsed.data);

    if (result.status === 'confirmed' && result.booking) {
      await scheduleBookingReminder({
        bookingId: result.booking.id,
        phone: parsed.data.customerPhone,
        customerName: result.booking.customer_name,
        resourceName: result.booking.resource_name ?? 'Cancha',
        startTimeIso: result.booking.start_time,
      }).catch(() => undefined);
    }

    const httpCode = result.status === 'confirmed' ? 201 : result.status === 'conflict' ? 409 : 400;
    res.status(httpCode).json(result);
  });

  router.delete('/admin/api/bookings/:id', requireAdminAuth, async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }

    const cancelled = await adminCancelBooking(getPool(), id);
    if (!cancelled) {
      res.status(404).json({ error: 'Reserva activa no encontrada' });
      return;
    }

    res.status(200).json({ status: 'cancelled', id });
  });

  return router;
}

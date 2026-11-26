CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  description TEXT,
  slot_duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (slot_duration_minutes > 0),
  open_hour SMALLINT NOT NULL DEFAULT 15 CHECK (open_hour BETWEEN 0 AND 23),
  close_hour SMALLINT NOT NULL DEFAULT 23 CHECK (close_hour BETWEEN 1 AND 24 AND close_hour > open_hour),
  price_per_hour NUMERIC(10, 2) NOT NULL DEFAULT 40.00 CHECK (price_per_hour >= 0),
  evening_start_hour SMALLINT CHECK (evening_start_hour BETWEEN 0 AND 23),
  evening_price_per_hour NUMERIC(10, 2) CHECK (evening_price_per_hour >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS evening_start_hour SMALLINT,
  ADD COLUMN IF NOT EXISTS evening_price_per_hour NUMERIC(10, 2);

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
  customer_phone TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  time_range TSTZRANGE NOT NULL,
  total_price NUMERIC(10, 2) NOT NULL DEFAULT 40.00 CHECK (total_price >= 0),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  reminder_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT chk_bookings_half_open_range CHECK (
    NOT isempty(time_range) AND lower_inc(time_range) AND NOT upper_inc(time_range)
  ),
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    resource_id WITH =,
    time_range WITH &&
  ) WHERE (status = 'confirmed')
);

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS total_price NUMERIC(10, 2) NOT NULL DEFAULT 40.00,
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

DO $$
BEGIN
  ALTER TABLE bookings
    ADD CONSTRAINT chk_bookings_half_open_range CHECK (
      NOT isempty(time_range) AND lower_inc(time_range) AND NOT upper_inc(time_range)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DROP INDEX IF EXISTS idx_bookings_customer_phone_status;
CREATE INDEX IF NOT EXISTS idx_bookings_confirmed_customer_phone
  ON bookings (customer_phone)
  WHERE status = 'confirmed';

CREATE TABLE IF NOT EXISTS chat_sessions (
  phone TEXT PRIMARY KEY,
  customer_name TEXT,
  last_user_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL REFERENCES chat_sessions(phone) ON DELETE CASCADE,
  wamid TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  tool_calls JSONB,
  tool_call_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP INDEX IF EXISTS idx_chat_messages_phone_created_at;
CREATE INDEX IF NOT EXISTS idx_chat_messages_phone_recent
  ON chat_messages (phone, created_at DESC, id DESC)
  WHERE role IN ('user', 'assistant');

ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS price_per_hour NUMERIC(10, 2) NOT NULL DEFAULT 40.00;

DELETE FROM resources r
WHERE r.name IN ('Cancha Sintetica 1', 'Cancha Sintetica 2', 'Consultorio A')
  AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.resource_id = r.id);

INSERT INTO resources (name, type, description, slot_duration_minutes, open_hour, close_hour, price_per_hour)
VALUES
  ('Cancha 1', 'cancha', 'Cancha de grass sintético 1', 60, 15, 23, 40.00),
  ('Cancha 2', 'cancha', 'Cancha de grass sintético 2', 60, 15, 23, 40.00)
ON CONFLICT (name) DO UPDATE SET
  slot_duration_minutes = EXCLUDED.slot_duration_minutes,
  open_hour = EXCLUDED.open_hour,
  close_hour = EXCLUDED.close_hour,
  price_per_hour = EXCLUDED.price_per_hour;

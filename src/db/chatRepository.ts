import type { Pool } from 'pg';

export interface StoredChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
}

export async function upsertChatSessionAndSaveUserMessage(
  pool: Pool,
  params: {
    phone: string;
    customerName: string | null;
    wamid: string;
    content: string;
  },
): Promise<{ isDuplicate: boolean; lastUserMessageAt: Date }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sessionRes = await client.query<{ last_user_message_at: Date }>(
      `INSERT INTO chat_sessions (phone, customer_name, last_user_message_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (phone) DO UPDATE SET
         customer_name = COALESCE(EXCLUDED.customer_name, chat_sessions.customer_name),
         last_user_message_at = NOW(),
         updated_at = NOW()
       RETURNING last_user_message_at`,
      [params.phone, params.customerName],
    );

    const msgRes = await client.query(
      `INSERT INTO chat_messages (phone, wamid, role, content)
       VALUES ($1, $2, 'user', $3)
       ON CONFLICT (wamid) DO NOTHING
       RETURNING id`,
      [params.phone, params.wamid, params.content],
    );

    await client.query('COMMIT');

    return {
      isDuplicate: msgRes.rowCount === 0,
      lastUserMessageAt: sessionRes.rows[0].last_user_message_at,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getRecentMessages(
  pool: Pool,
  phone: string,
  limit = 10,
): Promise<StoredChatMessage[]> {
  const { rows } = await pool.query<StoredChatMessage>(
    `SELECT role, content
     FROM (
       SELECT role, content, created_at, id
       FROM chat_messages
       WHERE phone = $1
         AND role IN ('user', 'assistant')
       ORDER BY created_at DESC, id DESC
       LIMIT $2
     ) recent
     ORDER BY created_at ASC, id ASC`,
    [phone, limit],
  );
  return rows;
}

export async function saveAssistantMessage(
  pool: Pool,
  phone: string,
  content: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO chat_messages (phone, role, content)
     VALUES ($1, 'assistant', $2)`,
    [phone, content],
  );
}

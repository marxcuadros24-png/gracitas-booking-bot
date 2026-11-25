# WhatsApp + LLM Booking System

Sistema de reservas por WhatsApp Cloud API con bloqueo de solapamientos en PostgreSQL (`tstzrange` + `btree_gist` + `EXCLUDE USING gist`), cola en Redis (`BullMQ`) y orquestador LLM con Function Calling determinista.

## Arquitectura

1. **PostgreSQL (`src/db/schema.sql`)**:
   - `resources`: canchas, consultorios o servicios con horario de atención y duración de slot.
   - `bookings`: usa `time_range TSTZRANGE` y `CONSTRAINT bookings_no_overlap EXCLUDE USING gist (resource_id WITH =, time_range WITH &&) WHERE (status = 'confirmed')`. Rechaza inserciones concurrentes solapadas con SQLSTATE `23P01`.
   - `chat_sessions`: rastrea `last_user_message_at` para validar la ventana de 24 horas de WhatsApp.
   - `chat_messages`: historial corto por teléfono y columna `wamid UNIQUE` para idempotencia.

2. **Webhook HTTP (`src/server.ts`, `src/whatsapp/webhook.ts`)**:
   - `GET /webhook`: valida `hub.verify_token` y retorna `hub.challenge`.
   - `POST /webhook`: verifica `X-Hub-Signature-256` con HMAC-SHA256, deduplica por `wamid` en Redis, encola en BullMQ y responde `200 OK` en < 5s.

3. **Worker & Orquestador LLM (`src/worker.ts`, `src/llm/orchestrator.ts`)**:
   - Consume la cola de Redis, inyecta la fecha/hora actual en `America/Lima`, carga los últimos 10 mensajes y ejecuta hasta 3 iteraciones de herramientas (`check_availability`, `create_booking`, `get_user_bookings`, `cancel_booking`).
   - Si `create_booking` recibe error `23P01`, devuelve `{ "status": "conflict", "alternatives": [...] }` al LLM.
   - Valida la ventana de 24 horas en `src/whatsapp/client.ts` antes de enviar texto libre.

## Arranque con Docker

```bash
cp .env.example .env
# Completa WHATSAPP_*, LLM_API_KEY en .env
docker compose up --build -d
```

## Exponer webhook local con Cloudflare Tunnel o ngrok

Con Cloudflare Tunnel:
```bash
cloudflared tunnel --url http://localhost:3000
```

O con ngrok:
```bash
ngrok http 3000
```

Configura la URL HTTPS resultante en **Meta for Developers > WhatsApp > Configuration**:
- **Callback URL**: `https://<tu-subdominio>/webhook`
- **Verify Token**: el valor de `WHATSAPP_VERIFY_TOKEN` en tu `.env`.

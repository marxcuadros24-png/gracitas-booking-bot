# Gracitas Booking Bot

Asistente conversacional de reservas por **WhatsApp Cloud API** para **Gracitas** (complejo de canchas de grass sintético), construido con **Node.js + TypeScript**, **PostgreSQL** (`tstzrange` + `btree_gist`), **Redis / BullMQ** y **LLM Function Calling**.

---

## Características principales

- **Cero dobles reservas concurrentes:** Restricción `EXCLUDE USING gist (resource_id WITH =, time_range WITH &&) WHERE (status = 'confirmed')` en PostgreSQL. Si dos clientes confirman el mismo horario en el mismo milisegundo, el segundo recibe `conflict` con horarios alternativos reales.
- **Webhook rápido (< 5 s) y seguro:**
  - `GET /webhook`: verificación en tiempo constante de `hub.verify_token`.
  - `POST /webhook`: validación HMAC-SHA256 (`X-Hub-Signature-256`), deduplicación por `wamid` en Redis y encolado inmediato en BullMQ.
- **Orquestador LLM determinista:**
  - El modelo nunca toca la base de datos directamente; opera mediante 4 herramientas estrictas (`check_availability`, `create_booking`, `get_user_bookings`, `cancel_booking`) con límite de 3 iteraciones por turno.
  - Inyección de fecha/hora exacta en `America/Lima`, regla de confirmación explícita previa a reservar y bloqueo estricto de temas ajenos al negocio.
  - Protección anti-IDOR: el teléfono del cliente se toma siempre de la sesión autenticada por Meta.
- **Regla de ventana de 24 horas:** Validación automática de `last_user_message_at` antes de enviar texto libre, con soporte de `sendWhatsAppTemplate` para recordatorios fuera de ventana.
- **Clean Architecture:** Puerto `BookingRepository` en dominio (`src/domain/booking.ts`) desacoplado del adaptador `PgBookingRepository` (`src/tools/bookingRepository.ts`).

---

## Reglas de negocio (Gracitas)

| Parámetro | Valor |
|---|---|
| Canchas activas | `Cancha 1`, `Cancha 2` |
| Horario de atención | `15:00` a `23:00` (`America/Lima`) |
| Duración por turno | `60 minutos` |
| Tarifa | `S/ 40.00` por hora |

---

## Arquitectura

```text
WhatsApp User ──► Meta Cloud API ──► POST /webhook (Express, HMAC + wamid dedup)
                                           │
                                           ▼ (200 OK < 5s)
                                     Redis / BullMQ
                                           │
                                           ▼
                                   Worker (LLM + Tools)
                                    ├──► PostgreSQL (GiST lock + chat_messages)
                                    └──► Meta Graph API (24h window guard)
```

### Estructura del proyecto

```text
src/
├── config/env.ts                  # Validación estricta de variables de entorno (Zod)
├── domain/booking.ts              # Puerto BookingRepository, DTOs y regla de 24 h
├── db/
│   ├── schema.sql                 # Tablas, GiST exclusion, CHECK e índices parciales
│   ├── migrate.ts                 # Ejecutor de migraciones
│   ├── pool.ts                    # Pool de conexiones PostgreSQL
│   └── chatRepository.ts          # Sesiones e historial corto (últimos 10 mensajes)
├── llm/
│   ├── prompt.ts                  # System prompt de Gracitas y límites de dominio
│   └── orchestrator.ts            # Bucle de tool calling (máx. 3 iteraciones)
├── queue/
│   ├── redis.ts                   # Conexión ioredis
│   └── bookingQueue.ts            # Cola BullMQ whatsapp-messages
├── tools/
│   ├── bookingRepository.ts       # Adaptador PgBookingRepository
│   └── definitions.ts             # Esquemas JSON estrictos y dispatcher
├── whatsapp/
│   ├── signature.ts               # HMAC-SHA256 y comparación en tiempo constante
│   ├── webhook.ts                 # Rutas GET / POST /webhook
│   └── client.ts                  # Envío por Graph API (texto y templates)
├── server.ts                      # Servidor HTTP Express (/health, /webhook)
└── worker.ts                      # Consumidor BullMQ
tests/                             # Unit tests + test real de concurrencia GiST
```

---

## Arranque rápido con Docker

1. Crea tu archivo `.env` a partir de la plantilla y completa tus credenciales (`WHATSAPP_*` y `LLM_API_KEY`):
   ```powershell
   Copy-Item .env.example .env
   ```
2. Levanta PostgreSQL, Redis, migraciones, API y Worker:
   ```powershell
   docker compose up --build -d
   ```
3. Verifica salud del servicio:
   ```powershell
   Invoke-RestMethod http://localhost:3000/health
   ```

### Exponer webhook local para Meta

Con **Cloudflare Tunnel** (o `ngrok http 3000`):
```powershell
cloudflared tunnel --url http://localhost:3000
```
Configura `https://<tu-subdominio>/webhook` y tu `WHATSAPP_VERIFY_TOKEN` en **Meta for Developers > WhatsApp > Configuration** y suscríbete al campo `messages`.

---

## Pruebas automatizadas

Incluye tests unitarios (firma HMAC, ventana 24 h, orquestador y anti-IDOR) y test de integración real contra PostgreSQL verificando que dos reservas simultáneas produzcan exactamente `confirmed` + `conflict`:

```bash
npm run typecheck
RUN_PG_INTEGRATION=1 npm test
```

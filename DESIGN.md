# DESIGN.md — Gracitas Admin Dashboard

## 1. Dirección Visual
Panel operativo para gestión diaria de canchas de grass sintético (**Gracitas**), inspirado en sistemas de gestión deportiva (EasyCancha / Playtomic Manager): alta legibilidad, bordes sutiles de `1px`, cero gradientes decorativos y densidad operativa clara.

## 2. Tokens Semánticos

| Token | Valor | Uso |
|---|---|---|
| `--bg-canvas` | `#F8FAFC` | Fondo general |
| `--bg-surface` | `#FFFFFF` | Tarjetas, grilla y modales |
| `--bg-subtle` | `#F1F5F9` | Cabeceras de tabla y estados neutros |
| `--border` | `#E2E8F0` | Contorno de tarjetas e inputs (`1px`) |
| `--text-primary` | `#0F172A` | Títulos, horas y cifras |
| `--text-secondary` | `#475569` | Etiquetas y metadatos |
| `--accent` | `#15803D` | Verde césped (CTA primario, disponible) |
| `--accent-soft` | `#DCFCE7` | Badge/fondo de turno disponible |
| `--danger` | `#B91C1C` | Cancelar reserva / errores |
| `--danger-soft` | `#FEE2E2` | Fondo de alerta o estado cancelado |

## 3. Tipografía y Ergonomía
- **Fuente:** `system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
- **Cifras:** `font-variant-numeric: tabular-nums` en horarios, precios (`S/ 40.00`) y KPIs.
- **Touch targets:** Mínimo `44px` de alto en botones e inputs; `16px` en inputs móviles.
- **Iconografía:** SVGs lineales (`stroke-width="1.75"`), cero emojis en UI.

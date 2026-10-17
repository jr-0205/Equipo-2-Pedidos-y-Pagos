# ROUTES — Equipo 2: Pedidos y Pagos

## Bases
- Pedidos: `PEDIDOS_URL` (puerto publicado 2503; interno 3003).
- Pagos: `PAGOS_URL` (puerto publicado 2504; interno 3004).
- PostgreSQL es interno a Docker; `POSTGRES_HOST_PORT` (5433) es solo administración y **no** es una API.

## Pedidos
| Método | Ruta | Función |
|---|---|---|
| GET | `/` | Información, contrato y URLs de integración configuradas |
| GET | `/health` | Salud del servicio y de PostgreSQL |
| GET | `/pedidos` | Listar pedidos persistidos (más recientes primero) |
| GET | `/pedidos/:id` | Consultar pedido |
| POST | `/pedidos` | Crear venta/pedido y ejecutar el flujo completo (ver sección Flujo) |
| GET | `/gateway/status` | Estado de las cinco integraciones externas |
| GET | `/gateway/clientes`, `/gateway/clientes/:id` | Proxy de Clientes (Equipo 1) |
| POST | `/gateway/clientes` | Proxy para crear cliente (Equipo 1) |
| PUT \| PATCH \| DELETE | `/gateway/clientes/:id` | Proxy para actualizar/eliminar cliente (Equipo 1) |
| GET | `/gateway/productos`, `/gateway/productos/:id` | Proxy del catálogo (Equipo 1) |
| POST | `/gateway/productos` | Proxy para crear producto (Equipo 1) |
| PUT \| PATCH \| DELETE | `/gateway/productos/:id` | Proxy para actualizar/eliminar producto (Equipo 1) |
| GET | `/gateway/pagos`, `/gateway/pagos/:id`, `/gateway/pagos/pedido/:pedidoId` | Proxy de Pagos |
| POST | `/gateway/pagos` | Proxy para registrar pago |
| GET | `/gateway/inventario`, `/gateway/inventario/:productoId` | Proxy de Inventario (Equipo 3) |
| PUT \| PATCH | `/gateway/inventario/:productoId` | Proxy para actualizar existencia (Equipo 3) |
| GET \| POST | `/gateway/notificaciones` | Proxy de Notificaciones (Equipo 3) |

Ejemplo POST:
```json
{ "clienteId": 1, "productoId": 1, "cantidad": 1, "metodoPago": "tarjeta" }
```
`precioUnitario` es opcional: con `PRODUCTOS_URL` configurado, el precio oficial se toma del catálogo.

## Pagos
| Método | Ruta | Función |
|---|---|---|
| GET | `/` | Información y contrato |
| GET | `/health` | Salud del servicio y de PostgreSQL |
| GET | `/pagos` | Listar pagos |
| GET | `/pagos/:id` | Consultar pago |
| GET | `/pagos/pedido/:pedidoId` | Pagos de un pedido |
| POST | `/pagos` | Registrar pago (idempotente por `pedidoId`) |

## Flujo
Pedidos valida cliente, producto y existencia; registra el pedido como `PENDIENTE_PAGO`;
solicita el pago; al aprobarse marca `PAGADO` y descuenta existencia; después registra las
notificaciones. Un error no implica necesariamente que no exista un pedido: consulta
`GET /pedidos` y su estado (`PENDIENTE_PAGO`, `PAGADO`, `PAGO_FALLIDO`,
`PAGADO_PENDIENTE_INVENTARIO`).

Eventos de notificación registrados en el Equipo 3:

| Servicio (`servicio`) | Cuándo | Contenido |
|---|---|---|
| `pagos` | Al aprobar el pago | "Pago aprobado y compra realizada con éxito" |
| `ventas` | Al completar pedido + inventario | "Venta confirmada: pedido #N, cantidad x producto, total" |

## Tolerancia con el Equipo 3
| Recurso | Ruta canónica (reglas.md) | Ruta heredada | Campos |
|---|---|---|---|
| Inventario | `/inventario`, `/inventario/:productoId` | `/api/products`, `/api/products/:id` | lee `stock` o `quantity`; escribe `stock`+`quantity` |
| Notificaciones | `/notificaciones` | `/api/notifications` | envía `servicio`+`service`, `mensaje`+`message`, `tipo`+`type` |

Se prueba primero la ruta canónica y, si responde 404/405, la heredada. Así el flujo funciona
con el Equipo 3 en cualquiera de las dos versiones.

## Contrato
Campos oficiales: `id`, `nombre`, `correo`, `precio`, `stock`; el pedido usa `clienteId`,
`productoId`, `cantidad`, `metodoPago`. Las respuestas conservan los nombres de columna y
agregan alias camelCase (`clienteId`, `productoId`, `precioUnitario`, `pagoId`, `metodoPago`,
`creadoEn`) para el frontend. Inventario es la fuente oficial de stock.

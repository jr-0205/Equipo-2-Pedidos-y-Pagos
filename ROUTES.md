# ROUTES — Equipo 2: Pedidos y Pagos

## Bases
- Pedidos: `PEDIDOS_URL` (puerto público 2503).
- Pagos: `PAGOS_URL` (puerto público 2504).
- PostgreSQL es interno a Docker; su puerto host de administración no es una API.

## Pedidos
| Método | Ruta | Función |
|---|---|---|
| GET | `/health` | Salud, DB e integraciones |
| GET | `/pedidos` | Listar pedidos persistidos |
| GET | `/pedidos/:id` | Consultar pedido |
| POST | `/pedidos` | Crear venta/pedido |
| GET | `/gateway/status` | Estado de conexiones externas |
| GET | `/gateway/clientes` | Proxy de clientes |
| GET | `/gateway/clientes/:id` | Proxy de cliente |
| GET | `/gateway/productos` | Proxy de catálogo |
| GET | `/gateway/inventario` | Proxy de inventario |

Ejemplo POST:
```json
{ "clienteId": 1, "productoId": 1, "cantidad": 1, "metodoPago": "tarjeta" }
```

## Pagos
| Método | Ruta | Función |
|---|---|---|
| GET | `/health` | Salud |
| GET | `/pagos` | Listar pagos |
| GET | `/pagos/:id` | Consultar pago |
| GET | `/pagos/pedido/:pedidoId` | Pagos de pedido |
| POST | `/pagos` | Registrar pago |

## Flujo
Pedidos valida cliente, producto y stock; registra pedido; solicita pago; tras aprobación actualiza inventario y notifica. Un error no implica necesariamente que no exista un pedido: consulta `GET /pedidos` y su estado.

## Contrato
Campos oficiales: `id`, `nombre`, `correo`, `precio`, `stock`; pedido usa `clienteId`, `productoId`, `cantidad`, `metodoPago`. Inventario es la fuente oficial de stock.

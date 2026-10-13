# Equipo 2 — Pedidos y Pagos

Microservicios REST con Node.js, Express, PostgreSQL y Docker Compose. Este repositorio contiene las API y su persistencia.

## Servicios y puertos publicados

- Pedidos: `http://localhost:2503` (puerto interno Docker: 3003).
- Pagos: `http://localhost:2504` (puerto interno Docker: 3004).
- PostgreSQL: puerto de administración local `5433`, no forma parte de los seis puertos de microservicios.

## Inicio

Copia `.env.example` a `.env` si todavía no tienes uno. Revisa las direcciones de los otros equipos antes de iniciar:

```bash
docker compose up --build -d
docker compose ps
```

Para ver logs: `docker compose logs --tail=100 pedidos pagos postgres`.
Pruebas rápidas: `curl http://localhost:2503/health`, `curl http://localhost:2504/health` y `curl http://localhost:2503/gateway/status`.
Para detener: `docker compose down`.

## Configuración de integración

En `.env` configura las direcciones base, sin agregar las rutas de los recursos:

```env
CLIENTES_URL=
PRODUCTOS_URL=http://host.docker.internal:2502
INVENTARIO_URL=
NOTIFICACIONES_URL=
```

Si Productos se ejecuta en la misma VM Linux que este proyecto, `host.docker.internal:2502` permite a Pedidos acceder al puerto 2502 publicado en el host; Compose ya declara el mapeo `host-gateway`. Si Productos está en otra computadora, cambia la URL por `http://IP-REAL:2502`. Si tu archivo `.env` existente contiene una `PRODUCTOS_URL` antigua, actualízala: los valores del archivo `.env` tienen prioridad sobre los valores predeterminados de Compose.

## Flujo de compra

1. Pedidos valida el cliente mediante el Equipo 1.
2. Pedidos consulta el producto y su precio en el Equipo 1.
3. Pedidos consulta el stock real del Equipo 3.
4. Registra el pedido y solicita el pago al microservicio Pagos.
5. Si el pago se aprueba, descuenta el stock en Inventario.
6. Pagos registra una notificación en el servicio Notificaciones.

## Contrato de datos

- Clientes: `id`, `nombre`, `correo`.
- Productos e inventario: `id`, `nombre`, `precio`, `stock`; Inventario también expone `descripcion`.
- Notificaciones: `id`, `servicio`, `mensaje`, `tipo`, `creado_en`.

Los nombres de campos se mantienen en español para las integraciones entre equipos.

## API de Pedidos

- `GET /health`
- `GET /pedidos`
- `GET /pedidos/:id`
- `POST /pedidos`

Ejemplo:

```json
{
  "clienteId": 1,
  "productoId": 1,
  "cantidad": 2,
  "metodoPago": "tarjeta"
}
```

Pedidos obtiene el precio de `productoId` desde Productos. También se puede enviar `precioUnitario` explícitamente cuando sea necesario.

Base URL desde el host: `http://localhost:2503`.

## API de Pagos

- `GET /health`
- `GET /pagos`
- `GET /pagos/:id`
- `GET /pagos/pedido/:pedidoId`
- `POST /pagos`

Base URL desde el host: `http://localhost:2504`.

## PostgreSQL

Docker crea las bases lógicas `pedidos_db` y `pagos_db`. El puerto de host para administración es configurable mediante `POSTGRES_HOST_PORT` (predeterminado `5433`).

## Red

Desde otras computadoras usa la IPv4 LAN del host y los puertos TCP 2503 y 2504. Dentro de Docker, los servicios se comunican por nombres de servicio y puertos internos.

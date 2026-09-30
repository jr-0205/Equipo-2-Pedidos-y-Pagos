# Equipo 2 — Pedidos y Pagos

Implementación del **Equipo 2** para la práctica de Microservicios Distribuidos con Docker.

## Qué incluye

- Microservicio **pedidos** en el puerto **3003**.
- Microservicio **pagos** en el puerto **3004**.
- **PostgreSQL** como base de datos.
- Una base lógica independiente para cada microservicio: `pedidos_db` y `pagos_db`.
- Docker Compose para levantar todo el equipo.
- Integración opcional con `clientes`, `productos`, `inventario` y `notificaciones`.
- Vista web para probar el flujo desde el navegador.
- Colección de Postman.

## Estructura

```text
.
├── BD/
│   └── init.sql
├── pedidos/
│   ├── public/
│   │   └── index.html
│   ├── app.js
│   ├── db.js
│   ├── Dockerfile
│   └── package.json
├── pagos/
│   ├── app.js
│   ├── db.js
│   ├── Dockerfile
│   └── package.json
├── postman/
│   └── Equipo-2-Pedidos-Pagos.postman_collection.json
├── .env.example
├── .gitignore
└── docker-compose.yml
```

## Puertos

| Servicio | Puerto |
|---|---:|
| pedidos | 3003 |
| pagos | 3004 |
| PostgreSQL | 5433 en el host / 5432 dentro de Docker |

## Inicio rápido

1. Clona el repositorio.
2. Copia `.env.example` a `.env`.
3. Levanta los contenedores:

```bash
docker compose up --build -d
```

4. Revisa el estado:

```bash
docker compose ps
```

5. Abre la vista de prueba:

```text
http://localhost:3003
```

Para apagar el proyecto:

```bash
docker compose down
```

Para borrar también los datos de PostgreSQL:

```bash
docker compose down -v
```

## Prueba independiente del Equipo 2

Mientras los otros equipos todavía no estén disponibles, deja vacías las URLs externas del archivo `.env`.

Crea un pedido enviando el precio manualmente:

```json
{
  "clienteId": 1,
  "productoId": 10,
  "cantidad": 2,
  "precioUnitario": 75.50,
  "metodoPago": "tarjeta"
}
```

Petición:

```text
POST http://localhost:3003/pedidos
```

El servicio `pedidos` registra el pedido y envía automáticamente la información de pago al servicio `pagos`.

## Integración con los otros equipos

Edita `.env` con las IP reales de las computadoras de los otros equipos. Ejemplo basado en el esquema de la práctica:

```env
CLIENTES_URL=http://192.168.1.101:3001
PRODUCTOS_URL=http://192.168.1.101:3002
INVENTARIO_URL=http://192.168.1.103:3005
NOTIFICACIONES_URL=http://192.168.1.103:3006
```

Después reinicia:

```bash
docker compose up --build -d
```

Cuando una URL está configurada, `pedidos` intenta integrarse con ese servicio:

1. Consulta `clientes/:id`.
2. Consulta `productos/:id`.
3. Consulta `inventario/:productoId`.
4. Registra el pedido.
5. Envía el pago a `pagos`.
6. Si el pago fue aprobado, intenta actualizar inventario.
7. Si está configurado, envía una notificación.

Para tolerar pequeñas diferencias entre los equipos, el precio del producto puede venir como `precio`, `precio_unitario` o `price`; la existencia puede venir como `existencia`, `stock` o `cantidad`.

## API de pedidos

| Método | Ruta | Función |
|---|---|---|
| GET | `/health` | Estado del microservicio y PostgreSQL |
| GET | `/pedidos` | Lista pedidos |
| GET | `/pedidos/:id` | Consulta un pedido |
| POST | `/pedidos` | Crea un pedido y solicita su pago |

### POST /pedidos

Campos:

- `clienteId`: obligatorio.
- `productoId`: obligatorio.
- `cantidad`: entero mayor que 0.
- `precioUnitario`: obligatorio sólo cuando no se usa el servicio de productos.
- `metodoPago`: opcional; por defecto `tarjeta`.

## API de pagos

| Método | Ruta | Función |
|---|---|---|
| GET | `/health` | Estado del microservicio y PostgreSQL |
| GET | `/pagos` | Lista pagos |
| GET | `/pagos/:id` | Consulta un pago |
| GET | `/pagos/pedido/:pedidoId` | Busca el pago de un pedido |
| POST | `/pagos` | Registra un pago proveniente de pedidos |

### POST /pagos

Ejemplo:

```json
{
  "pedidoId": 1,
  "monto": 151.00,
  "metodo": "tarjeta"
}
```

El endpoint es idempotente por `pedidoId`: si recibe dos veces el mismo pedido, devuelve el pago ya registrado en vez de duplicarlo.

## PostgreSQL

Docker crea automáticamente:

- `pedidos_db`: tabla `pedidos`.
- `pagos_db`: tabla `pagos`.

Credenciales de laboratorio por defecto:

```text
usuario: tienda
contraseña: tienda123
host desde Windows: localhost
puerto desde Windows: 5433
```

Estas credenciales son únicamente para el entorno de práctica. Para otro entorno deben cambiarse.

## Postman

Importa:

```text
postman/Equipo-2-Pedidos-Pagos.postman_collection.json
```

La colección incluye salud, alta y consulta de pedidos, y alta y consulta de pagos.

## Comunicación en red local

- Entre contenedores del Equipo 2 se utiliza la red interna de Docker.
- Para otros equipos se utiliza la IP local de la computadora anfitriona y el puerto publicado.
- No uses como hostname el nombre del contenedor de otro equipo.
- Verifica que Windows Firewall permita los puertos 3003 y 3004.

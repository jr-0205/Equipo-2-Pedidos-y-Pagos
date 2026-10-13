# Equipo 2 — Pedidos y Pagos

Implementación del **Equipo 2** para la práctica de Microservicios Distribuidos con Docker.

## Qué incluye

- Microservicio **pedidos** en el puerto **3003**.
- Microservicio **pagos** en el puerto **3004**.
- **PostgreSQL** como base de datos.
- Una base lógica independiente para cada microservicio: `pedidos_db` y `pagos_db`.
- Docker Compose para levantar todo el equipo.
- Integración opcional con `clientes`, `productos`, `inventario` y `notificaciones`.
- **Front integrado** para consumir y probar los seis microservicios.
- Colección de Postman.

## Front integrado

La aplicación web se sirve desde `pedidos/public/index.html`.

Después de levantar Docker:

```text
http://localhost:3003
```

El panel incluye:

- estado de los seis servicios;
- clientes;
- productos;
- pedidos;
- pagos;
- inventario;
- notificaciones;
- configuración de IP y puerto por equipo;
- consola HTTP;
- visualización del flujo de integración de un pedido.

La configuración detallada está en [FRONTEND.md](./FRONTEND.md). Las operaciones de edición/eliminación se reenvían a las APIs externas del Equipo 1, por lo que esos servicios deben implementar los métodos correspondientes.

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
├── FRONTEND.md
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

5. Abre:

```text
http://localhost:3003
```

Para apagar:

```bash
docker compose down
```

Para borrar también los datos:

```bash
docker compose down -v
```

## Prueba independiente del Equipo 2

Mientras los otros equipos todavía no estén disponibles, deja vacías las URLs externas del archivo `.env`.

Ejemplo:

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

El servicio `pedidos` registra el pedido y envía automáticamente la información a `pagos`.

## Integración con los otros equipos

Configura `.env` con las IP reales:

```env
CLIENTES_URL=http://IP-EQUIPO-1:3001
PRODUCTOS_URL=http://IP-EQUIPO-1:3002
INVENTARIO_URL=http://IP-EQUIPO-3:20002
NOTIFICACIONES_URL=http://IP-EQUIPO-3:20003
```

Después:

```bash
docker compose up --build -d
```

Flujo de pedidos:

1. consulta `clientes/:id`;
2. consulta `productos/:id`;
3. consulta `GET /api/products/:id` del servicio Inventario del Equipo 3;
4. registra el pedido;
5. envía el pago a `pagos`;
6. actualiza `quantity` mediante `PUT /api/products/:id` del Equipo 3;
7. envía una notificación a `POST /api/notifications` del Equipo 3;

Contrato Equipo 1: Clientes usa `id`, `nombre` y `correo`; Productos usa `id`, `nombre`, `precio` y `stock`. Pedidos lee el precio del catálogo exclusivamente desde `precio`. El adaptador de inventario utiliza la API actual del Equipo 3 (`/api/products`, puerto publicado 20002) y su campo `quantity`; lo estandarizaremos cuando editemos el Equipo 3.

## API de pedidos

| Método | Ruta | Función |
|---|---|---|
| GET | `/health` | Estado del servicio y PostgreSQL |
| GET | `/pedidos` | Lista pedidos |
| GET | `/pedidos/:id` | Consulta un pedido |
| POST | `/pedidos` | Crea un pedido y solicita su pago |

## API de pagos

| Método | Ruta | Función |
|---|---|---|
| GET | `/health` | Estado del servicio y PostgreSQL |
| GET | `/pagos` | Lista pagos |
| GET | `/pagos/:id` | Consulta un pago |
| GET | `/pagos/pedido/:pedidoId` | Busca el pago de un pedido |
| POST | `/pagos` | Registra un pago |

## PostgreSQL

Docker crea:

- `pedidos_db`: tabla `pedidos`;
- `pagos_db`: tabla `pagos`.

Credenciales de laboratorio:

```text
usuario: tienda
contraseña: tienda123
host desde Windows: localhost
puerto desde Windows: 5433
```

## Postman

Importa:

```text
postman/Equipo-2-Pedidos-Pagos.postman_collection.json
```

## Comunicación en red local

- Dentro del Equipo 2 se usa la red interna de Docker.
- Entre computadoras se usa la IP local del host y el puerto publicado.
- No uses como hostname el nombre del contenedor de otro equipo.
- Verifica Firewall de Windows y CORS para las peticiones desde el navegador.

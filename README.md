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
CLIENTES_URL=http://192.168.1.101:3001
PRODUCTOS_URL=http://192.168.1.101:3002
INVENTARIO_URL=http://192.168.1.103:3005
NOTIFICACIONES_URL=http://192.168.1.103:3006
```

Después:

```bash
docker compose up --build -d
```

Flujo de pedidos:

1. consulta `clientes/:id`;
2. consulta `productos/:id`;
3. consulta `inventario/:productoId`;
4. registra el pedido;
5. envía el pago a `pagos`;
6. actualiza inventario;
7. envía una notificación.

El precio puede venir como `precio`, `precio_unitario` o `price`; la existencia como `existencia`, `stock` o `cantidad`.

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

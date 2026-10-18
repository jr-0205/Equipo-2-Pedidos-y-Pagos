# Equipo 2 — Pedidos y Pagos

Microservicios REST con **Node.js, Express, PostgreSQL y Docker Compose**. Este repositorio
contiene las API, su persistencia y el **orquestador del flujo de compra** del proyecto
(consulta a los equipos 1 y 3). Cumple el reglamento común (`../reglas.md`).

| Documento | Contenido |
|---|---|
| Este README | Cómo ejecutar, rutas, contrato y cómo conectar con los equipos 1 y 3 |
| `../reglas.md` | Acuerdo de integración de los tres equipos (puertos, red, firewall, checklist) |
| `ROUTES.md` | Rutas y contratos de este equipo (documento compartido con los otros equipos) |
| `MICROSERVICES_STANDARD.md` | Estándar general de microservicios SuperPOS (acuerdo de los tres equipos) |
| `.env.example` | Plantilla de configuración común: puertos e IPs/hosts de los tres equipos |
| `postman/` | Colección Postman con el flujo completo y el gateway |

## 1. Servicios y puertos

| Servicio | Puerto interno (contenedor) | Puerto publicado (host) | URL desde otra PC | Base de datos |
|---|---:|---:|---|---|
| **pedidos** | 3003 | **2503** | `http://IP-EQUIPO-2:2503` | PostgreSQL `pedidos_db` |
| **pagos** | 3004 | **2504** | `http://IP-EQUIPO-2:2504` | PostgreSQL `pagos_db` |
| postgres | 5432 | 5433 | — (solo administración) | volumen `equipo2_postgres_data` |

- Dentro de esta computadora: `http://pedidos:3003`, `http://pagos:3004` y
  `http://postgres:5432` (red Docker `equipo2-net`).
- Entre computadoras: IP de esta PC + puertos **2503** y **2504**. Nunca `localhost`
  ni el nombre del contenedor.
- El 5433 **no** es uno de los seis microservicios públicos de la práctica.

## 2. Estructura

```text
Equipo-2-Pedidos-y-Pagos/
|-- pedidos/            # API de pedidos (orquestador del flujo)
|   |-- app.js
|   |-- db.js
|   |-- Dockerfile
|   |-- package.json
|-- pagos/              # API de pagos (notifica al Equipo 3)
|   |-- app.js
|   |-- db.js
|   |-- Dockerfile
|   |-- package.json
|-- BD/init.sql         # crea las bases pedidos_db y pagos_db
|-- postman/
|-- docker-compose.yml
|-- .env.example
|-- README.md
```

## 3. Ejecutar

```powershell
git clone https://github.com/<usuario>/Equipo-2-Pedidos-y-Pagos.git
cd Equipo-2-Pedidos-y-Pagos
node configurar-ips.mjs          # genera el .env a partir de ip-path
docker compose up --build -d
docker compose ps                # espera a que pedidos y pagos estén "healthy"
```

### Configurar las direcciones de todos los equipos (`ip-path`)

`ip-path` es la **única fuente de verdad** de las direcciones: se edita una vez y un comando
genera el `.env` de este repositorio (que es local y no se versiona).

```powershell
notepad ip-path                  # IP de cada laptop; deja `auto` en esta PC
node configurar-ips.mjs          # genera el .env
node configurar-ips.mjs --probar # además prueba /health de cada dirección
```

- `auto` significa "ese equipo corre en esta computadora"; para los contenedores se traduce
  en `host.docker.internal` (el `docker-compose.yml` ya lo habilita con `extra_hosts`).
- Pedidos necesita `EQUIPO1_HOST` (clientes y productos) y `EQUIPO3_HOST` (inventario y
  notificaciones); `EQUIPO2_HOST=auto` deja Pedidos y Pagos en esta computadora.
- Antes de sobrescribir un `.env` existente se guarda una copia en `.env.respaldo`.
- Si los cuatro repositorios están en la misma carpeta, se configura todo de una vez desde la
  raíz del proyecto con `node configurar-ips.mjs`.

Todas las plantillas `.env.example` de los tres equipos declaran las URLs de los seis
microservicios y del frontend, para mantener un **mapa común**, y `configurar-ips.mjs` las
rellena desde `ip-path`. Nunca uses `localhost` para un servicio alojado en otra computadora.
Tras cambiar las direcciones, recrea los contenedores con
`docker compose up -d --force-recreate pedidos pagos`.

Comprobaciones rápidas:

```powershell
Invoke-RestMethod http://localhost:2503/health
Invoke-RestMethod http://localhost:2504/health
Invoke-RestMethod http://localhost:2503/gateway/status
```

`/gateway/status` es la vista consolidada: muestra cada servicio externo del `.env` con su
URL, si está configurado y si responde.

## 4. Rutas de Pedidos — base `http://IP-EQUIPO-2:2503`

| Método | Ruta | Función |
|---|---|---|
| GET | `/` | Información, contrato e integraciones configuradas |
| GET | `/health` | Estado del servicio y de PostgreSQL |
| GET | `/pedidos` | Lista pedidos (más recientes primero) |
| GET | `/pedidos/:id` | Consulta un pedido |
| POST | `/pedidos` | **Crea el pedido y ejecuta el flujo completo** |
| GET | `/gateway/status` | Estado de las cinco integraciones |
| GET | `/gateway/clientes`, `/gateway/clientes/:id` | Consulta Clientes (Equipo 1) |
| POST | `/gateway/clientes` | Crea cliente (Equipo 1) |
| PUT/PATCH/DELETE | `/gateway/clientes/:id` | Modifica cliente (Equipo 1) |
| GET | `/gateway/productos`, `/gateway/productos/:id` | Consulta Productos (Equipo 1) |
| POST/PUT/PATCH/DELETE | `/gateway/productos...` | Modifica productos (Equipo 1) |
| GET | `/gateway/pagos`, `/gateway/pagos/:id`, `/gateway/pagos/pedido/:pedidoId` | Consulta Pagos |
| POST | `/gateway/pagos` | Registra pago |
| GET | `/gateway/inventario`, `/gateway/inventario/:productoId` | Consulta Inventario (Equipo 3) |
| PUT | `/gateway/inventario/:productoId` | Fija la existencia |
| PATCH | `/gateway/inventario/:productoId` | Ajusta la existencia con `{ "delta": -2 }` |
| GET/POST | `/gateway/notificaciones` | Consulta o registra Notificaciones (Equipo 3) |

### `POST /pedidos` — petición y respuesta

Petición:

```json
{
  "clienteId": 1,
  "productoId": 1,
  "cantidad": 2,
  "precioUnitario": 75.50,
  "metodoPago": "tarjeta"
}
```

`precioUnitario` es opcional: si está configurado `PRODUCTOS_URL`, el precio se toma del
catálogo del Equipo 1 y el valor enviado se sobreescribe.

Respuesta `201`:

```json
{
  "pedido": {
    "id": 1, "cliente_id": 1, "clienteId": 1, "producto_id": 1, "productoId": 1,
    "cantidad": 2, "precio_unitario": "75.50", "precioUnitario": "75.50",
    "total": "151.00", "estado": "PAGADO", "pago_id": 1, "pagoId": 1,
    "creado_en": "2026-10-17T20:00:00.000Z", "creadoEn": "2026-10-17T20:00:00.000Z"
  },
  "pago": { "id": 1, "pedidoId": 1, "monto": "151.00", "metodoPago": "tarjeta", "estado": "APROBADO" },
  "integracion": {
    "clienteConsultado": true, "productoConsultado": true, "inventarioConsultado": true,
    "pagoRegistrado": true, "inventarioActualizado": true, "notificacionEnviada": true
  },
  "advertenciaNotificacion": null
}
```

Estados posibles del pedido: `PENDIENTE_PAGO`, `PAGADO`, `PAGO_FALLIDO`,
`PAGADO_PENDIENTE_INVENTARIO`.

Códigos de error:

| Código | Cuándo |
|---|---|
| `400` | `clienteId`/`productoId`/`cantidad` inválidos o precio indeterminado |
| `409` | Existencia insuficiente en Inventario (`{ error, existencia, solicitada }`) |
| `502` | El pedido se creó pero falló el pago o la actualización de inventario |
| `503` | Un servicio externo no está configurado en el `.env` |

## 5. Rutas de Pagos — base `http://IP-EQUIPO-2:2504`

| Método | Ruta | Función |
|---|---|---|
| GET | `/` | Información y contrato |
| GET | `/health` | Estado del servicio y de PostgreSQL |
| GET | `/pagos` | Lista pagos |
| GET | `/pagos/:id` | Consulta un pago |
| GET | `/pagos/pedido/:pedidoId` | Consulta el pago de un pedido |
| POST | `/pagos` | Registra el pago (`{ pedidoId, monto, metodo }`) y notifica al Equipo 3 |

- Un pedido solo puede tener un pago (`pedido_id` es `UNIQUE`): repetir el `POST` devuelve
  el pago existente con **`200`** e `integracion.pagoExistente: true`, **sin** duplicar el
  registro ni generar otra notificación. Un pago nuevo responde `201`.
- Si Notificaciones no está configurado o falla, el pago **sí** se registra y la respuesta
  incluye `advertenciaNotificacion` con el motivo.
- Forma de la respuesta del `POST`:
  `{ "pago": { ... }, "integracion": { "notificacionEnviada": true, "pagoExistente": false }, "advertenciaNotificacion": null, "notificacion": { ... } }`

## 6. Contrato de datos entre equipos

| Recurso | Campos oficiales |
|---|---|
| Pedidos | `id`, `clienteId`, `productoId`, `cantidad`, `precioUnitario`, `total`, `estado`, `pagoId`, `creadoEn` |
| Pagos | `id`, `pedidoId`, `monto`, `metodoPago`, `estado`, `referencia`, `creadoEn` |
| Clientes (E1) | `id`, `nombre`, `correo` |
| Productos (E1) | `id`, `nombre`, `precio`, `stock` |
| Inventario (E3) | `id`, `nombre`, `precio`, `stock` |

Las respuestas de Pedidos y Pagos incluyen **también** los nombres de columna de la base
(`cliente_id`, `producto_id`, `precio_unitario`, `pago_id`, `creado_en`, `pedido_id`,
`metodo_pago`) para no romper al front ni a colecciones antiguas de Postman.

### Tolerancia con el Equipo 3

`INVENTARIO_URL` y `NOTIFICACIONES_URL` se consumen probando **primero la ruta canónica**
acordada y luego la ruta heredada del Equipo 3, y los datos se leen/escriben con los dos
vocabularios cuando hace falta:

| Recurso | Ruta canónica (reglas.md) | Ruta heredada (E3 actual) | Campos |
|---|---|---|---|
| Inventario | `/inventario`, `/inventario/:productoId` | `/api/products`, `/api/products/:id` | lee `stock` o `quantity`; escribe `stock`+`quantity` |
| Notificaciones | `/notificaciones` | `/api/notifications` | envía `servicio`+`service`, `mensaje`+`message`, `tipo`+`type` |

Por eso el flujo funciona con el Equipo 3 en cualquiera de las dos versiones.

## 7. Flujo de compra que implementa Pedidos

1. `pedidos` valida el cliente en **Clientes** (`CLIENTES_URL`).
2. `pedidos` consulta el producto y su precio en **Productos** (`PRODUCTOS_URL`).
3. `pedidos` verifica existencia en **Inventario** (`INVENTARIO_URL`) y responde `409` si falta.
4. Registra el pedido como `PENDIENTE_PAGO` y solicita el pago a **Pagos** (mismo equipo).
5. Al aprobarse el pago, el pedido pasa a `PAGADO` (o `PAGADO_PENDIENTE_INVENTARIO` si falla el paso 6).
6. Descuenta la existencia en **Inventario** (`PUT`).
7. **Pagos** registra la notificación del pago en **Notificaciones** (`NOTIFICACIONES_URL`).
8. **Pedidos** registra además la notificación de la venta (`servicio: "ventas"`, con pedido,
   cantidad y total). Si este último paso falla, la venta **no** se pierde: la respuesta
   incluye `advertenciaNotificacion` y el pedido queda registrado como pagado.

Cada paso queda reflejado en el objeto `integracion` de la respuesta.

## 8. Configuración de integración (`.env`)

La plantilla `.env.example` es la **común de los tres equipos**: declara los hosts y los
puertos de los seis microservicios y del frontend. Ajusta los hosts y, si no tienes DNS
local, escribe la IP actual de cada laptop.

```env
EQUIPO1_HOST=equipo1.local     # o la IPv4 de la laptop del Equipo 1
EQUIPO2_HOST=equipo2.local     # esta computadora
EQUIPO3_HOST=equipo3.local     # o la IPv4 de la laptop del Equipo 3
FRONTEND_HOST=frontend.local

CLIENTES_URL=http://${EQUIPO1_HOST}:2501
PRODUCTOS_URL=http://${EQUIPO1_HOST}:2502
INVENTARIO_URL=http://${EQUIPO3_HOST}:2506
NOTIFICACIONES_URL=http://${EQUIPO3_HOST}:2507

PEDIDOS_PORT=2503
PAGOS_PORT=2504
POSTGRES_HOST_PORT=5433

POSTGRES_USER=tienda
POSTGRES_PASSWORD=tienda123
PEDIDOS_DATABASE_URL=postgresql://tienda:tienda123@postgres:5432/pedidos_db
PAGOS_DATABASE_URL=postgresql://tienda:tienda123@postgres:5432/pagos_db
REQUEST_TIMEOUT_MS=10000
```

Reglas: **puertos publicados**, nunca `localhost` (dentro del contenedor `localhost` es el
propio contenedor), nunca el nombre del contenedor de otro equipo. Si una URL queda vacía,
esa integración se omite y `/gateway/status` lo indica.

### Datos de contacto de este equipo (llenar y compartir)

| Dato | Valor |
|---|---|
| Integrantes | |
| IPv4 de la laptop (`ipconfig`) | |
| Hostname (`hostname`) | |
| Puertos publicados | 2503 (pedidos), 2504 (pagos) |
| Firewall abierto | ☐ 2503 ☐ 2504 |

## 9. Firewall de Windows (en esta computadora)

```powershell
New-NetFirewallRule -DisplayName "Micro E2 Pedidos 2503" -Direction Inbound -Protocol TCP -LocalPort 2503 -Action Allow
New-NetFirewallRule -DisplayName "Micro E2 Pagos 2504"   -Direction Inbound -Protocol TCP -LocalPort 2504 -Action Allow
Get-NetConnectionProfile     # el perfil de red debe ser Private, no Public
```

## 10. Comprobaciones obligatorias

Desde esta computadora:

```powershell
Invoke-RestMethod http://localhost:2503/health
Invoke-RestMethod http://localhost:2504/health
Invoke-RestMethod http://localhost:2503/gateway/status
```

Desde otra computadora:

```powershell
Test-Connection 192.168.1.102 -Count 2
Test-NetConnection 192.168.1.102 -Port 2503
Test-NetConnection 192.168.1.102 -Port 2504
Invoke-RestMethod http://192.168.1.102:2503/health
```

Venta de prueba (requiere Cliente y Producto con el mismo ID en Inventario):

```powershell
$body = @{ clienteId = 1; productoId = 1; cantidad = 1; metodoPago = "tarjeta" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:2503/pedidos -ContentType "application/json" -Body $body
```

## 11. Administración

```powershell
docker compose ps
docker compose logs --tail=100 pedidos pagos postgres
docker compose down          # detener
docker compose down -v       # detener y BORRAR las bases de datos (destructivo)
```

## 12. Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `/gateway/status` muestra `configured: false` | Variable vacía en `.env` | Escribir la URL con IP + puerto **publicado** |
| `No fue posible consultar clientes/productos` | Firewall del otro equipo o IP equivocada | `Test-NetConnection IP -Port 2501` y revisar sus reglas de firewall |
| `409 Existencia insuficiente` en todas las ventas | El producto no existe en Inventario o el stock está en 0 | Crear el artículo en Inventario con el **mismo ID** del catálogo |
| `502 ... no fue posible actualizar inventario` | El Equipo 3 rechazó el `PUT` | Revisar `docker compose logs` y la versión de la API de Inventario |
| `advertenciaNotificacion` con texto | Notificaciones no configurado o caído | Configurar `NOTIFICACIONES_URL`; el pago no se pierde |
| El pedido queda `PAGO_FALLIDO` | Pagos no respondió | `docker compose ps`; el contenedor lo levanta este mismo compose |
| Postgres no arranca | Volumen con datos de otra versión | Revisar logs; `docker compose down -v` solo si se acepta borrar datos |

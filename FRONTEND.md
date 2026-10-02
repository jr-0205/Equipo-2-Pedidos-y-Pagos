# Front integrado — Tienda Universitaria

La vista web está en:

```text
pedidos/public/index.html
```

Se sirve desde **Pedidos**:

```text
http://localhost:3003
```

## Cambio importante: gateway del Equipo 2

El navegador ya no consulta directamente a los puertos de los otros equipos.

Ahora el flujo es:

```text
Navegador
   |
   v
Pedidos :3003
   |
   +-- /gateway/clientes      -> Equipo 1 :3001
   +-- /gateway/productos     -> Equipo 1 :3002
   +-- /gateway/pagos         -> Equipo 2 :3004
   +-- /gateway/inventario    -> Equipo 3 :3005
   +-- /gateway/notificaciones-> Equipo 3 :3006
```

Esto evita que el front dependa de la configuración CORS de las computadoras de los otros equipos.

## Configuración correcta del .env

Usa solamente la URL base del servicio.

Ejemplo para una computadora del Equipo 1 en `192.168.6.63`:

```env
CLIENTES_URL=http://192.168.6.63:3001
PRODUCTOS_URL=http://192.168.6.63:3002
```

No uses:

```env
CLIENTES_URL=http://192.168.6.63:3001/clientes
PRODUCTOS_URL=http://192.168.6.63:3002/productos
```

El backend agrega automáticamente las rutas `/clientes` y `/productos`.

También se normalizan URLs que accidentalmente terminen con el nombre del servicio, pero es mejor mantener el archivo limpio.

## Endpoints del gateway

| Método | Ruta del Equipo 2 | Destino |
|---|---|---|
| GET | `/gateway/status` | comprueba las integraciones |
| GET | `/gateway/clientes` | `GET /clientes` |
| GET | `/gateway/clientes/:id` | `GET /clientes/:id` |
| POST | `/gateway/clientes` | `POST /clientes` |
| GET | `/gateway/productos` | `GET /productos` |
| GET | `/gateway/productos/:id` | `GET /productos/:id` |
| GET | `/gateway/pagos` | `GET /pagos` |
| POST | `/gateway/pagos` | `POST /pagos` |
| GET | `/gateway/inventario/:productoId` | consulta existencia |
| PUT | `/gateway/inventario/:productoId` | actualiza existencia |
| POST | `/gateway/notificaciones` | registra notificación |

## Front

El panel incluye:

- detección de estado de los seis servicios;
- conteo de clientes, productos, pedidos y pagos;
- consulta y alta de clientes;
- catálogo de productos;
- creación y listado de pedidos;
- consulta y registro de pagos;
- consulta y actualización de inventario;
- envío de notificaciones;
- consola HTTP;
- visualización del flujo de integración.

## Aplicar cambios

Después de editar `.env`:

```bash
docker compose down
docker compose up --build -d
docker compose ps
```

Luego abre:

```text
http://localhost:3003
```

## Diagnóstico

Para el Equipo 1, estas URLs deben abrir desde Windows:

```text
http://192.168.6.63:3001/clientes
http://192.168.6.63:3002/productos
```

Pero en el `.env` deben guardarse sin `/clientes` ni `/productos`.

Si el navegador abre esas URLs pero `/gateway/status` dice que no hay conexión, revisa:

1. que el contenedor de Pedidos tenga las variables del `.env`;
2. que se haya reconstruido el contenedor después de cambiar el archivo;
3. que Docker pueda alcanzar la IP LAN;
4. que Firewall de Windows permita los puertos publicados.

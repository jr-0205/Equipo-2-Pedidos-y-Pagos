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
| PUT/PATCH/DELETE | `/gateway/clientes/:id` | actualiza o elimina un cliente |
| GET | `/gateway/productos` | `GET /productos` |
| GET | `/gateway/productos/:id` | `GET /productos/:id` |
| POST | `/gateway/productos` | `POST /productos` |
| PUT/PATCH/DELETE | `/gateway/productos/:id` | actualiza o elimina un producto |
| GET | `/gateway/pagos` | `GET /pagos` |
| POST | `/gateway/pagos` | `POST /pagos` |
| GET | `/gateway/inventario/:productoId` | consulta existencia |
| PUT | `/gateway/inventario/:productoId` | actualiza existencia |
| POST | `/gateway/notificaciones` | registra notificación |

## Front

El panel incluye:

- detección de estado de los seis servicios;
- conteo de clientes, productos, pedidos y pagos;
- consulta, alta, búsqueda, edición y eliminación de clientes;
- catálogo de productos con alta, búsqueda, edición y eliminación;
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


## Demostración del flujo

El menú **Flujo** permite demostrar en una sola pantalla el recorrido real de una compra:

1. **Clientes** — `GET /clientes/:id`: valida al cliente.
2. **Productos** — `GET /productos/:id`: obtiene producto y precio.
3. **Inventario** — `GET /inventario/:productoId`: comprueba existencia.
4. **Pedidos** — `POST /pedidos`: registra el pedido y orquesta el proceso.
5. **Pagos** — `POST /pagos`: registra el pago.
6. **Inventario** — `PUT /inventario/:productoId`: descuenta existencias.
7. **Notificaciones** — `POST /notificaciones`: registra el mensaje final.

Los pasos se marcan visualmente como **completados**, **omitidos** o **fallidos** usando los datos reales devueltos por el microservicio Pedidos.

Para la demostración final, los tres equipos deben estar conectados y las cuatro URLs externas del `.env` del Equipo 2 deben estar configuradas.


## Probar experiencia de usuario

El menú **Experiencia de usuario** presenta el sistema como una tienda normal, ocultando rutas, JSON y detalles internos.

La demostración continua es:

1. seleccionar un perfil de cliente;
2. navegar el catálogo;
3. agregar productos al carrito;
4. cambiar cantidades o eliminar productos;
5. elegir forma de pago;
6. finalizar la compra;
7. recibir una confirmación con folio, total y método de pago.

Internamente, el front sigue consumiendo los microservicios reales. Si hay varios productos en el carrito, se generan los pedidos correspondientes de forma secuencial y la interfaz los agrupa como una sola experiencia de compra.

Esta vista está pensada para mostrar el sistema desde la perspectiva de un usuario final; la pestaña **Flujo** queda disponible para explicar después qué microservicios participaron por detrás.


### Contrato real de Notificaciones

El microservicio de Notificaciones espera que Pagos envíe una petición `POST /notificaciones` con este formato:

```json
{
  "origen": "pagos",
  "mensaje": "Pago aprobado y compra realizada con exito",
  "tipo": "SUCCESS"
}
```

El Equipo 2 conserva `NOTIFICACIONES_URL` como variable de entorno; no se fija la IP en el código. Si el servicio de Notificaciones está en `192.200.5.142:3006`, configura localmente:

```env
NOTIFICACIONES_URL=http://192.200.5.142:3006
```

Pagos envía la notificación después de confirmar el pago.


## Gestión de catálogo desde el panel

En **Productos** se puede agregar un producto con nombre y precio, buscar en el catálogo y usar las acciones de cada fila para editarlo o eliminarlo. En **Clientes** también se puede buscar, editar y eliminar, además de registrar nuevos clientes.

Estas operaciones pasan por el gateway del Equipo 2 y se reenvían al microservicio correspondiente del Equipo 1. Para que crear/editar/eliminar funcione, las APIs externas deben implementar `POST /productos`, `PUT /productos/:id` o `PATCH /productos/:id`, `DELETE /productos/:id` y las rutas equivalentes de clientes. Si el servicio externo no implementa una operación, el panel mostrará el error que devuelva la API; el gateway no guarda un catálogo duplicado localmente.

El Equipo 2 conserva el alcance de la práctica: pedidos se crean/consultan y pagos se registran/consultan; no se habilita la edición o eliminación de transacciones financieras desde el navegador.

# Front integrado — Tienda Universitaria

La vista web está en:

```text
pedidos/public/index.html
```

Se sirve desde el microservicio **pedidos**, por lo que después de levantar Docker se abre en:

```text
http://localhost:3003
```

## Qué consume

| Equipo | Servicio | Puerto | Rutas usadas por el front |
|---|---|---:|---|
| 1 | clientes | 3001 | `GET /clientes`, `POST /clientes` |
| 1 | productos | 3002 | `GET /productos`, `GET /productos/:id` |
| 2 | pedidos | 3003 | `GET /health`, `GET /pedidos`, `POST /pedidos` |
| 2 | pagos | 3004 | `GET /health`, `GET /pagos`, `POST /pagos` |
| 3 | inventario | 3005 | `GET /inventario/:productoId`, `PUT /inventario/:productoId` |
| 3 | notificaciones | 3006 | `POST /notificaciones` |

## Configuración del navegador

En la sección **Conexiones** del front coloca la IP real de cada computadora. Ejemplo:

```text
clientes       http://192.168.1.101:3001
productos      http://192.168.1.101:3002
pedidos        http://192.168.1.102:3003
pagos          http://192.168.1.102:3004
inventario     http://192.168.1.103:3005
notificaciones http://192.168.1.103:3006
```

Estas URLs se guardan en `localStorage` del navegador.

## Configuración del backend de pedidos

Para que `POST /pedidos` ejecute el flujo distribuido completo, también configura el archivo `.env` del Equipo 2:

```env
CLIENTES_URL=http://192.168.1.101:3001
PRODUCTOS_URL=http://192.168.1.101:3002
INVENTARIO_URL=http://192.168.1.103:3005
NOTIFICACIONES_URL=http://192.168.1.103:3006
```

Después reconstruye:

```bash
docker compose up --build -d
```

## Flujo esperado

1. pedidos valida al cliente;
2. consulta el producto;
3. consulta inventario;
4. registra el pedido;
5. solicita el pago;
6. actualiza inventario;
7. solicita una notificación.

## Problemas frecuentes

### Failed to fetch

Verifica:

- que las computadoras estén en la misma red;
- que los puertos 3001 a 3006 estén publicados y permitidos por Firewall;
- que los microservicios externos permitan CORS;
- que se use la IP de la computadora anfitriona, no el nombre del contenedor del otro equipo.

### Equipo 2 funciona, pero los demás no

El front puede probar pedidos y pagos localmente aunque los otros equipos estén apagados. Para crear pedidos sin productos externo, captura también `precioUnitario`.

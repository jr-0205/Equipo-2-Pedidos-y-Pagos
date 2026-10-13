# Estándar general de microservicios SuperPOS

**Estado:** contrato objetivo compartido. Antes de implementar una regla en producción, verificar que el servicio ya la cumpla; la existencia de este documento no prueba que esté implementada.

## 1. Principios obligatorios

1. Cada servicio tiene una sola responsabilidad y es dueño de sus datos.
2. La comunicación entre servicios ocurre mediante HTTP/REST y JSON, usando las URL de configuración. No consultar directamente la base de datos de otro servicio.
3. No escribir IP de equipos directamente en el código. Leerlas de variables de entorno.
4. En Docker, entre contenedores del mismo Compose se usa el nombre del servicio y su puerto interno; desde otra computadora se usa la dirección DNS/IP del host y el puerto publicado.
5. No considerar un servicio disponible solo porque su contenedor está iniciado: comprobar salud y una petición real.
6. Toda operación debe responder con estado HTTP apropiado y datos en un contrato documentado.
7. No devolver contraseñas, tokens, cadenas de conexión ni trazas internas al cliente.
8. Las operaciones de escritura deben validar entradas y nunca reportar éxito si la persistencia o una dependencia obligatoria falló.

## 2. Configuración

- Mantener `.env` local y fuera de Git; versionar `.env.example` sin secretos reales.
- Definir URL base explícita por dependencia, por ejemplo `CLIENTES_URL`, `PRODUCTOS_URL`, `INVENTARIO_URL`, `PAGOS_URL`, `NOTIFICACIONES_URL`.
- Definir `PORT`, tiempos de espera y credenciales mediante variables de entorno.
- Fallar al iniciar con mensaje claro si falta una variable obligatoria; no usar una URL falsa como si fuera válida.
- Usar DNS estable o reserva DHCP para hosts dinámicos. Si cambia un host, actualizar el entorno y recrear/reconstruir cuando corresponda.
- Establecer un tiempo de espera finito para cada llamada HTTP; manejar errores de red, respuestas no-2xx y JSON inválido.
- No repetir automáticamente operaciones de escritura salvo que exista una clave de idempotencia o garantía de que la repetición es segura.

## 3. Contrato HTTP

- JSON UTF-8 para solicitudes y respuestas; las escrituras deben usar `Content-Type: application/json`.
- Usar sustantivos en rutas y verbos HTTP con significado consistente: GET leer, POST crear/ejecutar, PUT reemplazar/actualizar, PATCH modificar parcialmente, DELETE eliminar.
- `GET /health` debe existir en cada servicio y devolver 200 solo cuando el proceso esté operativo. Se recomienda distinguir salud del proceso y disponibilidad de dependencias.
- Mantener las rutas, métodos, campos y códigos de respuesta documentados en `ROUTES.md`.
- No cambiar ni eliminar un campo del contrato sin actualizar consumidores y documentación; preferir cambios compatibles y versionar cambios incompatibles.
- CORS debe permitir explícitamente el origen del frontend cuando el navegador llama directamente a la API.
- Validar identificadores, tipos, campos requeridos, límites numéricos y valores permitidos antes de procesar.

## 4. Formato de objetos JSON

Los objetos son contratos de datos, no instancias internas de una base de datos. En la frontera HTTP se intercambian DTO/objetos JSON planos; no enviar clases serializadas, objetos de conexión, funciones ni secretos.

### Cliente
```json
{ "id": 12, "nombre": "Ana Pérez", "correo": "ana@example.com" }
```

### Producto (catálogo)
```json
{ "id": 34, "nombre": "Teclado", "descripcion": "USB", "precio": 450.00 }
```

### Existencia de inventario
```json
{ "productoId": 34, "stock": 8 }
```

### Pedido
```json
{
  "id": 1001,
  "clienteId": 12,
  "productoId": 34,
  "cantidad": 2,
  "precioUnitario": 450.00,
  "total": 900.00,
  "estado": "PENDIENTE_PAGO"
}
```

### Pago
```json
{
  "id": 5001,
  "pedidoId": 1001,
  "monto": 900.00,
  "metodoPago": "tarjeta",
  "estado": "APROBADO"
}
```

### Notificación
```json
{
  "id": 7001,
  "tipo": "PEDIDO_PAGADO",
  "referenciaId": 1001,
  "mensaje": "El pedido fue pagado"
}
```

Reglas de objetos:
- Usar `id` como identificador propio y `clienteId`, `productoId`, `pedidoId` como referencias a otros recursos.
- Los IDs deben conservar el tipo y significado entre servicios; no emparejar registros por nombre, correo o posición en una lista.
- Usar exactamente los nombres de campo acordados. No alternar `name/nombre`, `price/precio`, `quantity/cantidad` o `email/correo` sin un adaptador explícito.
- `precio`, `precioUnitario`, `total` y montos deben ser números finitos no negativos; no confiar en el total enviado por el cliente. El servicio responsable calcula el total usando precio oficial y cantidad validada.
- `stock` y `cantidad` son enteros no negativos; cantidad de una venta debe ser mayor que cero.
- Fechas, cuando se agreguen, usar ISO 8601 en UTC. Los campos opcionales deben omitirse o documentarse; no cambiar arbitrariamente entre `null`, cadena vacía y ausencia.
- No aceptar del cliente campos de control como estado final de pago, rol, precio oficial o stock disponible cuando los calcula un servicio dueño.

## 5. Propiedad de datos y responsabilidad

- Clientes es dueño de los datos de clientes.
- Productos es dueño del catálogo y de los precios comerciales.
- Inventario es dueño de las existencias disponibles.
- Pedidos es dueño del registro y estado del pedido.
- Pagos es dueño del registro y resultado del pago.
- Notificaciones es dueño del registro de notificaciones.
- Cada servicio escribe únicamente en su propia base de datos. No compartir tablas ni credenciales de base de datos entre servicios.

## 6. Flujo de venta esperado

1. Frontend envía a Pedidos `clienteId`, `productoId`, `cantidad` y `metodoPago`; no es fuente confiable de precio, total, stock ni resultado de pago.
2. Pedidos valida el cliente con Clientes, el producto/precio con Productos y disponibilidad con Inventario.
3. Pedidos registra el pedido en un estado inicial definido y guarda una instantánea del precio unitario y total calculado.
4. Pedidos solicita el pago a Pagos usando el ID del pedido y el monto calculado.
5. Si el pago se rechaza, marcar el pedido como fallido/rechazado y no descontar inventario.
6. Si el pago se aprueba, descontar stock de forma atómica y evitar que dos ventas vendan las mismas unidades.
7. Registrar notificación después de conocer el resultado definitivo.
8. Responder éxito solo si se alcanzó el estado definido como éxito. Si un paso posterior falla después de que el pago fue aprobado, registrar el estado parcial y permitir reconciliación; nunca fingir que no ocurrió el pago.
9. Las operaciones críticas deben ser idempotentes: repetir la misma solicitud no debe cobrar ni descontar stock dos veces. Usar clave de idempotencia o una referencia única de operación.
10. Documentar la política de compensación/reconciliación cuando el pago se aprueba pero falla el descuento de stock o la notificación.

## 7. Estados y errores

- Usar estados consistentes, en mayúsculas y documentados. Pedido sugerido: `PENDIENTE_PAGO`, `PAGADO`, `PAGO_FALLIDO`, `CANCELADO`, `ERROR_RECONCILIACION`.
- Pago sugerido: `PENDIENTE`, `APROBADO`, `RECHAZADO`, `ERROR`.
- No confundir error técnico con rechazo de pago.
- Formato de error recomendado:
```json
{
  "error": {
    "codigo": "PRODUCTOS_NO_DISPONIBLE",
    "mensaje": "No fue posible consultar el catálogo",
    "detalles": []
  }
}
```
- Usar 400 para datos inválidos, 401/403 para autenticación/autorización cuando exista, 404 para recurso inexistente, 409 para conflicto/stock insuficiente/duplicado, 502 o 503 para dependencia fallida y 500 para error interno.
- Registrar errores con contexto/correlation ID sin incluir secretos. Devolver el mismo `correlationId` en respuestas relacionadas para seguir una venta entre servicios.

## 8. Persistencia y objetos de base de datos

- Definir claves primarias, restricciones únicas, claves foráneas locales e índices apropiados.
- Usar transacciones para cambios que deben ocurrir juntos dentro de una misma base de datos.
- No asumir que el arranque vuelve a ejecutar scripts de inicialización sobre un volumen existente.
- No borrar volúmenes de Docker para resolver errores de credenciales sin respaldo y diagnóstico.
- Guardar estados y resultados suficientes para auditar/reconciliar pedidos y pagos.
- Nunca depender del orden de filas; ordenar explícitamente cuando se requiera.

## 9. Seguridad

- No subir secretos a GitHub ni incluirlos en respuestas de error.
- Validar y limitar el tamaño de las peticiones.
- Restringir CORS y exposición de puertos a la red necesaria.
- En un entorno real, usar autenticación/autorización entre servicios, TLS y gestión de secretos; una red local no equivale a una red segura.
- No registrar datos de tarjeta ni credenciales sensibles.

## 10. Pruebas de aceptación antes de declarar un servicio listo

- `GET /health` devuelve 200.
- Rutas principales responden con el esquema esperado.
- Pruebas de entradas inválidas producen 4xx claros.
- La persistencia sobrevive al reinicio del contenedor.
- Se prueban dependencias inaccesibles, timeout y respuestas inválidas.
- Prueba de venta aprobada: pedido persistido, pago asociado, stock descontado una sola vez y notificación registrada.
- Prueba de pago rechazado: pedido con estado de fallo y stock sin descontar.
- Prueba de repetición: no duplicar pedido/pago/descuento.
- Frontend muestra el estado real del servidor; el modo de demostración debe estar explícitamente activado y etiquetado.
- Ejecutar `docker compose config --quiet`, pruebas de cada servicio y prueba integrada entre equipos.

## 11. Cómo aplicar el estándar

Este archivo define el contrato objetivo; no significa que todas las reglas estén ya implementadas. Al modificar un servicio:
1. Revisar el código actual y las rutas reales.
2. Implementar los cambios compatibles.
3. Actualizar `ROUTES.md` y `.env.example`.
4. Añadir pruebas unitarias e integración.
5. Probar localmente y entre hosts antes de marcarlo como listo.

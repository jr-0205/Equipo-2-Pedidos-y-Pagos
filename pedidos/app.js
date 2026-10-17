const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { pool, initDb } = require('./db');

const RUNNING_IN_DOCKER = fs.existsSync('/.dockerenv');

const app = express();
const PORT = Number(process.env.PORT || 3003);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 5000);

const PAGOS_URL = normalizeServiceBaseUrl(process.env.PAGOS_URL || 'http://pagos:3004', 'pagos');
const CLIENTES_URL = normalizeServiceBaseUrl(process.env.CLIENTES_URL || '', 'clientes');
const PRODUCTOS_URL = normalizeServiceBaseUrl(process.env.PRODUCTOS_URL || '', 'productos');
const INVENTARIO_URL = normalizeServiceBaseUrl(process.env.INVENTARIO_URL || '', 'inventario');
const NOTIFICACIONES_URL = normalizeServiceBaseUrl(process.env.NOTIFICACIONES_URL || '', 'notificaciones');

// Rutas canónicas acordadas en reglas.md y rutas heredadas que aún usa el Equipo 3.
// Se prueban en orden: primero el acuerdo común, luego la variante antigua.
const INVENTARIO_PATHS = ['/inventario', '/api/products'];
const NOTIFICACIONES_PATHS = ['/notificaciones', '/api/notifications'];

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function normalizeServiceBaseUrl(value, serviceName = '') {
  let url = String(value || '').trim().replace(/\/+$/, '');

  if (!url || !serviceName) {
    return url;
  }

  const suffix = '/' + serviceName.toLowerCase();
  if (url.toLowerCase().endsWith(suffix)) {
    url = url.slice(0, -suffix.length).replace(/\/+$/, '');
  }

  // Dentro de un contenedor, localhost apunta al propio contenedor.
  // En Docker Desktop para Windows, host.docker.internal apunta al host.
  if (RUNNING_IN_DOCKER) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        parsed.hostname = 'host.docker.internal';
        url = parsed.toString().replace(/\/$/, '');
      }
    } catch {
      // Si no es una URL válida, se conserva para que el error real sea visible.
    }
  }

  return url;
}

async function probeHttp(url) {
  if (!url) {
    return { configured: false, reachable: false, status: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return {
      configured: true,
      reachable: true,
      status: response.status
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      status: null,
      error: error.name === 'AbortError' ? 'timeout' : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function gatewayRequest(res, baseUrl, serviceName, pathSuffix, options = {}) {
  if (!baseUrl) {
    return res.status(503).json({
      error: 'Servicio no configurado',
      servicio: serviceName,
      detalle: 'Configura ' + serviceName.toUpperCase() + '_URL en el archivo .env del Equipo 2.'
    });
  }

  try {
    const data = await requestJson(baseUrl + pathSuffix, options);
    return res.json(data);
  } catch (error) {
    return res.status(error.status || 502).json({
      error: 'No fue posible consultar ' + serviceName,
      detalle: (error.data && error.data.mensaje) || error.message,
      upstream: error.data || null
    });
  }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstDefined() {
  for (const value of arguments) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
}

function extractCollection(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const candidates = [
    payload.data,
    payload.datos,
    payload.items,
    payload.resultados,
    payload.inventario,
    payload.productos,
    payload.clientes,
    payload.pagos
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function inventoryProductId(item) {
  if (!item || typeof item !== 'object') return null;
  return firstDefined(
    item.id,
    item.productoId,
    item.producto_id,
    item.productId,
    item.idProducto,
    item.producto && item.producto.id
  );
}

function genericRecordId(item) {
  if (!item || typeof item !== 'object') return null;
  return firstDefined(
    item.id,
    item._id,
    item.clienteId,
    item.cliente_id,
    item.productoId,
    item.producto_id,
    item.productId,
    item.idCliente,
    item.idProducto
  );
}

function findRecordById(payload, id) {
  if (!payload || typeof payload !== 'object') return null;

  const directId = genericRecordId(payload);
  if (directId !== null && String(directId) === String(id)) {
    return payload;
  }

  const collection = extractCollection(payload);
  return collection.find((item) =>
    String(genericRecordId(item)) === String(id)
  ) || null;
}

async function getServiceRecord(baseUrl, resourceName, id) {
  if (!baseUrl) return null;

  // Primero intenta el endpoint REST individual.
  try {
    const direct = await requestJson(
      baseUrl + '/' + resourceName + '/' + encodeURIComponent(id)
    );
    const record = findRecordById(direct, id);

    // Algunos servicios regresan directamente el objeto sin envolverlo.
    if (record) return record;
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct;
    }
  } catch (error) {
    // Si el otro equipo no implementó /:id, usar la colección completa.
    if (error.status && ![404, 405].includes(error.status)) {
      throw error;
    }
  }

  const collectionPayload = await requestJson(baseUrl + '/' + resourceName);
  const record = findRecordById(collectionPayload, id);

  if (!record) {
    const error = new Error(
      resourceName.slice(0, -1) + ' ' + id + ' no encontrado'
    );
    error.status = 404;
    error.data = collectionPayload;
    throw error;
  }

  return record;
}


function findInventoryRecord(payload, productoId) {
  if (!payload || typeof payload !== 'object') return null;

  const directId = inventoryProductId(payload);
  if (directId !== null && String(directId) === String(productoId)) {
    return payload;
  }

  // El Equipo 3 usa "quantity"; el contrato acordado usa "stock".
  if (payload.quantity !== undefined || payload.stock !== undefined) {
    return payload;
  }

  const collection = extractCollection(payload);
  return collection.find((item) =>
    String(inventoryProductId(item)) === String(productoId)
  ) || null;
}

// Consulta inventario probando primero la ruta canónica (/inventario)
// y después la ruta heredada del Equipo 3 (/api/products).
async function getInventoryRecord(productoId) {
  if (!INVENTARIO_URL) return null;

  let lastError = null;

  for (const basePath of INVENTARIO_PATHS) {
    try {
      const direct = await requestJson(
        INVENTARIO_URL + basePath + '/' + encodeURIComponent(productoId)
      );
      const record = findInventoryRecord(direct, productoId);

      if (record) return record;
      if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
        return direct;
      }
    } catch (error) {
      if (error.status && ![404, 405].includes(error.status)) {
        lastError = error;
      }
    }
  }

  for (const basePath of INVENTARIO_PATHS) {
    try {
      const list = await requestJson(INVENTARIO_URL + basePath);
      const record = findInventoryRecord(list, productoId);

      if (record) return record;
    } catch (error) {
      if (error.status && ![404, 405].includes(error.status)) {
        lastError = error;
      }
    }
  }

  if (lastError) throw lastError;

  const error = new Error('Producto ' + productoId + ' no encontrado en inventario');
  error.status = 404;
  throw error;
}

// Actualiza la existencia del producto en inventario. Se envía el mismo dato con
// los dos vocabularios (español e inglés) para que funcione con cualquiera de las
// versiones del servicio de Inventario.
async function updateInventoryStock(productoId, inventarioActual, nuevaExistencia) {
  const payload = {
    nombre: inventarioActual.nombre ?? inventarioActual.name ?? '',
    name: inventarioActual.nombre ?? inventarioActual.name ?? '',
    descripcion: inventarioActual.descripcion ?? inventarioActual.description ?? '',
    description: inventarioActual.descripcion ?? inventarioActual.description ?? '',
    stock: nuevaExistencia,
    quantity: nuevaExistencia,
    precio: numberOrNull(firstDefined(inventarioActual.precio, inventarioActual.price)) ?? 0,
    price: numberOrNull(firstDefined(inventarioActual.precio, inventarioActual.price)) ?? 0
  };

  const id = encodeURIComponent(productoId);
  let lastError = null;

  for (const basePath of INVENTARIO_PATHS) {
    try {
      return await requestJson(INVENTARIO_URL + basePath + '/' + id, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
    } catch (error) {
      if (error.status && ![404, 405].includes(error.status)) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError || new Error('No fue posible actualizar inventario');
}

function extractPrice(producto) {
  if (!producto || typeof producto !== 'object') return null;

  return numberOrNull(firstDefined(
    producto.precio,
    producto.price
  ));
}

function extractStock(inventario) {
  if (!inventario || typeof inventario !== 'object') return null;

  return numberOrNull(firstDefined(
    inventario.stock,
    inventario.quantity,
    inventario.existencia,
    inventario.inventario
  ));
}

// Respuestas del Equipo 2: se conservan los nombres de columna y además se agregan
// los alias en camelCase del contrato acordado (clienteId, productoId, ...).
function serializePedido(row) {
  if (!row || typeof row !== 'object') return row;

  return {
    ...row,
    clienteId: firstDefined(row.clienteId, row.cliente_id),
    productoId: firstDefined(row.productoId, row.producto_id),
    precioUnitario: firstDefined(row.precioUnitario, row.precio_unitario),
    pagoId: firstDefined(row.pagoId, row.pago_id),
    creadoEn: firstDefined(row.creadoEn, row.creado_en),
    actualizadoEn: firstDefined(row.actualizadoEn, row.actualizado_en)
  };
}

function serializePago(row) {
  if (!row || typeof row !== 'object') return row;

  const pago = row.pago ? row.pago : row;
  const serializado = {
    ...pago,
    pedidoId: firstDefined(pago.pedidoId, pago.pedido_id),
    metodoPago: firstDefined(pago.metodoPago, pago.metodo_pago, pago.metodo),
    creadoEn: firstDefined(pago.creadoEn, pago.creado_en)
  };

  return row.pago ? { ...row, pago: serializado } : serializado;
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      signal: controller.signal
    });

    const raw = await response.text();
    let data = null;

    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = { raw };
      }
    }

    if (!response.ok) {
      const error = new Error('HTTP ' + response.status + ' al consultar ' + url);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Tiempo de espera agotado al consultar ' + url);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function setPedidoState(id, estado, pagoId = null) {
  const result = await pool.query(
    `
      UPDATE pedidos
      SET estado = $2,
          pago_id = COALESCE($3, pago_id),
          actualizado_en = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, estado, pagoId]
  );

  return result.rows[0];
}

async function gatewayMutation(res, baseUrl, serviceName, pathSuffix, method, body) {
  if (!baseUrl) {
    return res.status(503).json({
      error: 'Servicio no configurado',
      servicio: serviceName,
      detalle: 'Configura ' + serviceName.toUpperCase() + '_URL en el archivo .env del Equipo 2.'
    });
  }
  try {
    const data = await requestJson(baseUrl + pathSuffix, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return res.status(method === 'POST' ? 201 : 200).json(data);
  } catch (error) {
    return res.status(error.status || 502).json({
      error: 'No fue posible modificar ' + serviceName,
      detalle: (error.data && (error.data.mensaje || error.data.error)) || error.message,
      upstream: error.data || null
    });
  }
}

async function createClientRecord(input) {
  if (!CLIENTES_URL) {
    const error = new Error('Servicio de clientes no configurado');
    error.status = 503;
    throw error;
  }

  const nombre = String(input && input.nombre || '').trim();
  const correo = String(input && input.correo || '').trim();

  if (!nombre || !correo) {
    const error = new Error('Nombre y correo electrónico son requeridos');
    error.status = 400;
    throw error;
  }

  try {
    return await requestJson(CLIENTES_URL + '/clientes', {
      method: 'POST',
      body: JSON.stringify({ nombre, correo })
    });
  } catch (error) {
    if (error.data && error.data.mensaje) {
      error.message = error.data.mensaje;
    }
    throw error;
  }
}
async function createProductRecord(input) {
  if (!PRODUCTOS_URL) {
    const error = new Error('Servicio de productos no configurado');
    error.status = 503;
    throw error;
  }
  const nombre = String(input && input.nombre || '').trim();
  const precio = numberOrNull(input && input.precio);
  if (!nombre) {
    const error = new Error('El nombre del producto es requerido');
    error.status = 400;
    throw error;
  }
  if (precio === null || precio < 0) {
    const error = new Error('El precio debe ser un número mayor o igual a cero');
    error.status = 400;
    throw error;
  }
  try {
    return await requestJson(PRODUCTOS_URL + '/productos', {
      method: 'POST',
      body: JSON.stringify({ nombre, precio })
    });
  } catch (error) {
    if (error.data && (error.data.mensaje || error.data.error)) {
      error.message = error.data.mensaje || error.data.error;
    }
    throw error;
  }
}

const ENDPOINTS = [
  'GET /health',
  'GET /',
  'GET /pedidos',
  'GET /pedidos/:id',
  'POST /pedidos',
  'GET /gateway/status',
  'GET|POST /gateway/clientes',
  'GET|POST /gateway/productos',
  'GET|POST /gateway/pagos',
  'GET|PUT /gateway/inventario',
  'GET|POST /gateway/notificaciones'
];

app.get('/', (req, res) => res.json({
  servicio: 'pedidos',
  equipo: 'Equipo 2 - Pedidos y Pagos',
  puertoInterno: PORT,
  contrato: {
    request: ['clienteId', 'productoId', 'cantidad', 'precioUnitario?', 'metodoPago?'],
    response: ['id', 'clienteId', 'productoId', 'cantidad', 'precioUnitario', 'total', 'estado', 'pagoId', 'creadoEn']
  },
  integraciones: {
    pagos: PAGOS_URL,
    clientes: CLIENTES_URL || null,
    productos: PRODUCTOS_URL || null,
    inventario: INVENTARIO_URL || null,
    notificaciones: NOTIFICACIONES_URL || null
  },
  endpoints: ENDPOINTS
}));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      ok: true,
      servicio: 'pedidos',
      puertoInterno: PORT,
      postgres: 'ok',
      integraciones: {
        clientes: Boolean(CLIENTES_URL),
        productos: Boolean(PRODUCTOS_URL),
        inventario: Boolean(INVENTARIO_URL),
        pagos: Boolean(PAGOS_URL),
        notificaciones: Boolean(NOTIFICACIONES_URL)
      }
    });
  } catch (error) {
    res.status(503).json({ status: 'error', ok: false, servicio: 'pedidos', error: error.message });
  }
});

app.get('/pedidos', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM pedidos ORDER BY id DESC');
    res.json(result.rows.map(serializePedido));
  } catch (error) {
    next(error);
  }
});

app.get('/pedidos/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'id inválido' });
    }

    const result = await pool.query('SELECT * FROM pedidos WHERE id = $1', [id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    res.json(serializePedido(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.post('/pedidos', async (req, res) => {
  const body = req.body || {};
  const clienteId = Number(body.clienteId ?? body.cliente_id);
  const productoId = Number(body.productoId ?? body.producto_id);
  const cantidad = Number(body.cantidad);
  const metodoPago = String(body.metodoPago ?? body.metodo ?? 'tarjeta').trim();
  let precioUnitario = numberOrNull(body.precioUnitario ?? body.precio_unitario);

  if (!Number.isInteger(clienteId) || clienteId <= 0) {
    return res.status(400).json({ error: 'clienteId debe ser un entero mayor que 0' });
  }

  if (!Number.isInteger(productoId) || productoId <= 0) {
    return res.status(400).json({ error: 'productoId debe ser un entero mayor que 0' });
  }

  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    return res.status(400).json({ error: 'cantidad debe ser un entero mayor que 0' });
  }

  if (!metodoPago) {
    return res.status(400).json({ error: 'metodoPago no puede estar vacío' });
  }

  let stockActual = null;
  let inventarioActual = null;
  const integracion = {
    clienteConsultado: false,
    productoConsultado: false,
    inventarioConsultado: false,
    pagoRegistrado: false,
    inventarioActualizado: false,
    notificacionEnviada: false
  };

  try {
    if (CLIENTES_URL) {
      await getServiceRecord(CLIENTES_URL, 'clientes', clienteId);
      integracion.clienteConsultado = true;
    }

    if (PRODUCTOS_URL) {
      const producto = await getServiceRecord(PRODUCTOS_URL, 'productos', productoId);
      const precioExterno = extractPrice(producto);

      if (precioExterno !== null) {
        precioUnitario = precioExterno;
      }

      integracion.productoConsultado = true;
    }

    if (precioUnitario === null || precioUnitario < 0) {
      return res.status(400).json({
        error: 'No se pudo determinar el precio. Envía precioUnitario o configura PRODUCTOS_URL con un producto que incluya precio.'
      });
    }

    if (INVENTARIO_URL) {
      const inventario = await getInventoryRecord(productoId);
      inventarioActual = inventario;
      stockActual = extractStock(inventario);
      integracion.inventarioConsultado = true;

      if (stockActual !== null && stockActual < cantidad) {
        return res.status(409).json({
          error: 'Existencia insuficiente',
          existencia: stockActual,
          solicitada: cantidad
        });
      }
    }

    const total = Number((precioUnitario * cantidad).toFixed(2));

    const insert = await pool.query(
      `
        INSERT INTO pedidos (
          cliente_id,
          producto_id,
          cantidad,
          precio_unitario,
          total,
          estado
        )
        VALUES ($1, $2, $3, $4, $5, 'PENDIENTE_PAGO')
        RETURNING *
      `,
      [clienteId, productoId, cantidad, precioUnitario, total]
    );

    let pedido = insert.rows[0];

    let pago;
    let advertenciaNotificacion = null;
    try {
      const pagoResponse = await requestJson(PAGOS_URL + '/pagos', {
        method: 'POST',
        body: JSON.stringify({
          pedidoId: Number(pedido.id),
          monto: total,
          metodo: metodoPago,
          metodoPago,
          origen: 'pedidos'
        })
      });

      // Pagos responde { pago, integracion, advertenciaNotificacion, notificacion }.
      // Aquí se guarda el pago "plano" y la advertencia por separado para que el
      // contrato de POST /pedidos sea { pedido, pago, integracion }.
      pago = pagoResponse && pagoResponse.pago ? pagoResponse.pago : pagoResponse;
      integracion.pagoRegistrado = true;
      integracion.notificacionEnviada = Boolean(
        pagoResponse &&
        pagoResponse.integracion &&
        pagoResponse.integracion.notificacionEnviada
      );
      advertenciaNotificacion =
        (pagoResponse && pagoResponse.advertenciaNotificacion) ||
        (pagoResponse && pagoResponse.pago && pagoResponse.pago.advertenciaNotificacion) ||
        null;
    } catch (error) {
      pedido = await setPedidoState(pedido.id, 'PAGO_FALLIDO');
      return res.status(502).json({
        error: 'El pedido se creó, pero no fue posible registrar el pago',
        detalle: error.message,
        pedido: serializePedido(pedido),
        integracion
      });
    }

    const pagoId = numberOrNull(firstDefined(
      pago && pago.id,
      pago && pago.pago && pago.pago.id
    ));
    pedido = await setPedidoState(pedido.id, 'PAGADO', pagoId);

    if (INVENTARIO_URL && inventarioActual && stockActual !== null) {
      const nuevaExistencia = stockActual - cantidad;

      try {
        await updateInventoryStock(productoId, inventarioActual, nuevaExistencia);
        integracion.inventarioActualizado = true;
      } catch (error) {
        pedido = await setPedidoState(pedido.id, 'PAGADO_PENDIENTE_INVENTARIO', pagoId);
        return res.status(502).json({
          error: 'El pago fue aprobado, pero no fue posible actualizar inventario',
          detalle: error.message,
          pedido: serializePedido(pedido),
          pago: serializePago(pago),
          integracion
        });
      }
    }

    const finalResult = await pool.query('SELECT * FROM pedidos WHERE id = $1', [pedido.id]);

    res.status(201).json({
      pedido: serializePedido(finalResult.rows[0]),
      pago: serializePago(pago),
      integracion,
      advertenciaNotificacion
    });
  } catch (error) {
    res.status(502).json({
      error: 'No fue posible completar la creación del pedido',
      detalle: error.message,
      servicioExterno: true,
      integracion
    });
  }
});


/*
 * Gateway del Equipo 2.
 * Estas rutas permiten consultar servicios externos desde la API de Pedidos.
 */
app.get('/gateway/status', async (req, res) => {
  const [clientes, productos, pagos, inventario, notificaciones] = await Promise.all([
    probeHttp(CLIENTES_URL ? CLIENTES_URL + '/clientes' : ''),
    probeHttp(PRODUCTOS_URL ? PRODUCTOS_URL + '/productos' : ''),
    probeHttp(PAGOS_URL + '/health'),
    probeHttp(INVENTARIO_URL ? INVENTARIO_URL + INVENTARIO_PATHS[0] : ''),
    probeHttp(NOTIFICACIONES_URL ? NOTIFICACIONES_URL + NOTIFICACIONES_PATHS[0] : '')
  ]);

  let pedidosOk = true;
  try {
    await pool.query('SELECT 1');
  } catch {
    pedidosOk = false;
  }

  res.json({
    pedidos: {
      configured: true,
      reachable: pedidosOk,
      status: pedidosOk ? 200 : 503,
      url: 'http://' + req.hostname + ':' + PORT
    },
    pagos: { ...pagos, url: PAGOS_URL },
    clientes: { ...clientes, url: CLIENTES_URL },
    productos: { ...productos, url: PRODUCTOS_URL },
    inventario: { ...inventario, url: INVENTARIO_URL },
    notificaciones: { ...notificaciones, url: NOTIFICACIONES_URL }
  });
});

app.get('/gateway/clientes', (req, res) =>
  gatewayRequest(res, CLIENTES_URL, 'clientes', '/clientes')
);

app.get('/gateway/clientes/:id', async (req, res) => {
  if (!CLIENTES_URL) {
    return res.status(503).json({
      error: 'Servicio no configurado',
      servicio: 'clientes',
      detalle: 'Configura CLIENTES_URL en el archivo .env del Equipo 2.'
    });
  }

  try {
    return res.json(await getServiceRecord(CLIENTES_URL, 'clientes', req.params.id));
  } catch (error) {
    return res.status(error.status || 502).json({
      error: 'No fue posible consultar clientes',
      detalle: error.message,
      upstream: error.data || null
    });
  }
});

app.post('/gateway/clientes', async (req, res) => {
  try {
    const cliente = await createClientRecord(req.body);
    return res.status(201).json(cliente);
  } catch (error) {
    return res.status(error.status || 502).json({
      error: 'No fue posible agregar el cliente',
      detalle: error.message,
      upstream: error.data || null
    });
  }
});


app.put('/gateway/clientes/:id', (req, res) =>
  gatewayMutation(res, CLIENTES_URL, 'clientes', '/clientes/' + encodeURIComponent(req.params.id), 'PUT', req.body)
);
app.patch('/gateway/clientes/:id', (req, res) =>
  gatewayMutation(res, CLIENTES_URL, 'clientes', '/clientes/' + encodeURIComponent(req.params.id), 'PATCH', req.body)
);
app.delete('/gateway/clientes/:id', (req, res) =>
  gatewayMutation(res, CLIENTES_URL, 'clientes', '/clientes/' + encodeURIComponent(req.params.id), 'DELETE')
);

app.get('/gateway/productos', (req, res) =>
  gatewayRequest(res, PRODUCTOS_URL, 'productos', '/productos')
);

app.get('/gateway/productos/:id', async (req, res) => {
  if (!PRODUCTOS_URL) {
    return res.status(503).json({
      error: 'Servicio no configurado',
      servicio: 'productos',
      detalle: 'Configura PRODUCTOS_URL en el archivo .env del Equipo 2.'
    });
  }

  try {
    return res.json(await getServiceRecord(PRODUCTOS_URL, 'productos', req.params.id));
  } catch (error) {
    return res.status(error.status || 502).json({
      error: 'No fue posible consultar productos',
      detalle: error.message,
      upstream: error.data || null
    });
  }
});


app.post('/gateway/productos', async (req, res) => {
  try {
    const producto = await createProductRecord(req.body);
    return res.status(201).json(producto);
  } catch (error) {
    return res.status(error.status || 502).json({
      error: 'No fue posible agregar el producto',
      detalle: error.message,
      upstream: error.data || null
    });
  }
});
app.put('/gateway/productos/:id', async (req, res) => {
  if (!PRODUCTOS_URL) {
    return res.status(503).json({ error: 'Servicio de productos no configurado' });
  }
  try {
    const current = await getServiceRecord(PRODUCTOS_URL, 'productos', req.params.id);
    const nombre = String(req.body && req.body.nombre || '').trim();
    const precio = numberOrNull(req.body && req.body.precio);
    if (!nombre || precio === null || precio < 0) {
      return res.status(400).json({ error: 'Los campos nombre y precio son obligatorios; precio debe ser no negativo' });
    }
    const updated = await requestJson(
      PRODUCTOS_URL + '/productos/' + encodeURIComponent(req.params.id),
      {
        method: 'PUT',
        body: JSON.stringify({
          nombre,
          precio,
          stock: Number(current.stock || 0)
        })
      }
    );
    return res.json(updated);
  } catch (error) {
    return res.status(error.status || 502).json({
      error: 'No fue posible actualizar el producto',
      detalle: error.message,
      upstream: error.data || null
    });
  }
});
app.patch('/gateway/productos/:id', (req, res) =>
  gatewayMutation(res, PRODUCTOS_URL, 'productos', '/productos/' + encodeURIComponent(req.params.id), 'PATCH', req.body)
);
app.delete('/gateway/productos/:id', (req, res) =>
  gatewayMutation(res, PRODUCTOS_URL, 'productos', '/productos/' + encodeURIComponent(req.params.id), 'DELETE')
);

app.get('/gateway/pagos', async (req, res) => {
  if (!PAGOS_URL) {
    return res.status(503).json({ error: 'Servicio de pagos no configurado' });
  }
  try {
    const data = await requestJson(PAGOS_URL + '/pagos');
    const lista = Array.isArray(data) ? data.map(serializePago) : data;
    return res.json(lista);
  } catch (error) {
    return res.status(error.status || 502).json({
      error: 'No fue posible consultar pagos',
      detalle: error.message,
      upstream: error.data || null
    });
  }
});

app.get('/gateway/pagos/pedido/:pedidoId', (req, res) =>
  gatewayRequest(res, PAGOS_URL, 'pagos', '/pagos/pedido/' + encodeURIComponent(req.params.pedidoId))
);

app.get('/gateway/pagos/:id', (req, res) =>
  gatewayRequest(res, PAGOS_URL, 'pagos', '/pagos/' + encodeURIComponent(req.params.id))
);

app.post('/gateway/pagos', (req, res) =>
  gatewayRequest(res, PAGOS_URL, 'pagos', '/pagos', {
    method: 'POST',
    body: JSON.stringify(req.body)
  })
);

app.get('/gateway/inventario', async (req, res) => {
  if (!INVENTARIO_URL) {
    return res.status(503).json({
      error: 'Servicio no configurado',
      servicio: 'inventario',
      detalle: 'Configura INVENTARIO_URL en el archivo .env del Equipo 2.'
    });
  }

  for (const basePath of INVENTARIO_PATHS) {
    try {
      return res.json(await requestJson(INVENTARIO_URL + basePath));
    } catch (error) {
      if (!error.status || ![404, 405].includes(error.status)) {
        return res.status(error.status || 502).json({
          error: 'No fue posible consultar inventario',
          detalle: error.message,
          upstream: error.data || null
        });
      }
    }
  }

  return res.status(502).json({ error: 'No fue posible consultar inventario' });
});

app.get('/gateway/inventario/:productoId', async (req, res) => {
  if (!INVENTARIO_URL) {
    return res.status(503).json({
      error: 'Servicio no configurado',
      servicio: 'inventario',
      detalle: 'Configura INVENTARIO_URL en el archivo .env del Equipo 2.'
    });
  }

  try {
    const record = await getInventoryRecord(req.params.productoId);
    return res.json(record);
  } catch (error) {
    return res.status(error.status || 502).json({
      error: 'No fue posible consultar inventario',
      detalle: error.message,
      upstream: error.data || null
    });
  }
});

app.put('/gateway/inventario/:productoId', async (req, res) => {
  if (!INVENTARIO_URL) {
    return res.status(503).json({ error: 'Servicio de inventario no configurado' });
  }
  try {
    const current = await getInventoryRecord(req.params.productoId);
    const quantity = Number(firstDefined(
      req.body && req.body.stock,
      req.body && req.body.quantity
    ));
    if (!Number.isInteger(quantity) || quantity < 0) {
      return res.status(400).json({ error: 'La existencia debe ser un entero mayor o igual a cero' });
    }
    const updated = await updateInventoryStock(req.params.productoId, current, quantity);
    return res.json(updated);
  } catch (error) {
    return res.status(error.status || 502).json({
      error: 'No fue posible actualizar inventario',
      detalle: error.message,
      upstream: error.data || null
    });
  }
});

app.patch('/gateway/inventario/:productoId', async (req, res) => {
  if (!INVENTARIO_URL) {
    return res.status(503).json({ error: 'Servicio de inventario no configurado' });
  }
  try {
    const current = await getInventoryRecord(req.params.productoId);
    const stockActual = extractStock(current);
    const delta = numberOrNull(firstDefined(
      req.body && req.body.delta,
      req.body && req.body.stock,
      req.body && req.body.quantity
    ));
    if (delta === null || stockActual === null) {
      return res.status(400).json({ error: 'Envía delta (entero) y asegúrate de que el producto exista en inventario' });
    }
    const updated = await updateInventoryStock(req.params.productoId, current, stockActual + delta);
    return res.json(updated);
  } catch (error) {
    return res.status(error.status || 502).json({
      error: 'No fue posible actualizar inventario',
      detalle: error.message,
      upstream: error.data || null
    });
  }
});

app.get('/gateway/notificaciones', async (req, res) => {
  if (!NOTIFICACIONES_URL) {
    return res.status(503).json({
      error: 'Servicio no configurado',
      servicio: 'notificaciones',
      detalle: 'Configura NOTIFICACIONES_URL en el archivo .env del Equipo 2.'
    });
  }

  for (const basePath of NOTIFICACIONES_PATHS) {
    try {
      return res.json(await requestJson(NOTIFICACIONES_URL + basePath));
    } catch (error) {
      if (!error.status || ![404, 405].includes(error.status)) {
        return res.status(error.status || 502).json({
          error: 'No fue posible consultar notificaciones',
          detalle: error.message,
          upstream: error.data || null
        });
      }
    }
  }

  return res.status(502).json({ error: 'No fue posible consultar notificaciones' });
});

app.post('/gateway/notificaciones', async (req, res) => {
  if (!NOTIFICACIONES_URL) {
    return res.status(503).json({
      error: 'Servicio no configurado',
      servicio: 'notificaciones',
      detalle: 'Configura NOTIFICACIONES_URL en el archivo .env del Equipo 2.'
    });
  }

  const servicio = (req.body && (req.body.servicio || req.body.service)) || 'equipo2';
  const mensaje = (req.body && (req.body.mensaje || req.body.message)) || '';
  const tipo = (req.body && (req.body.tipo || req.body.type)) || 'info';
  // Se envían los dos vocabularios para ser compatibles con cualquier versión.
  const body = JSON.stringify({
    servicio, service: servicio,
    mensaje, message: mensaje,
    tipo, type: tipo
  });

  for (const basePath of NOTIFICACIONES_PATHS) {
    try {
      return res.json(await requestJson(NOTIFICACIONES_URL + basePath, { method: 'POST', body }));
    } catch (error) {
      if (!error.status || ![404, 405].includes(error.status)) {
        return res.status(error.status || 502).json({
          error: 'No fue posible registrar la notificación',
          detalle: error.message,
          upstream: error.data || null
        });
      }
    }
  }

  return res.status(502).json({ error: 'No fue posible registrar la notificación' });
});

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: 'Error interno del servicio pedidos' });
});

async function start() {
  try {
    await initDb();
    app.listen(PORT, '0.0.0.0', () => {
      console.log('Servicio pedidos escuchando en el puerto ' + PORT);
    });
  } catch (error) {
    console.error('No fue posible iniciar pedidos:', error);
    process.exit(1);
  }
}

async function shutdown() {
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();

const express = require('express');
const cors = require('cors');
const path = require('path');
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

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
      detalle: error.message,
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

async function createClientRecord(input) {
  if (!CLIENTES_URL) {
    const error = new Error('Servicio de clientes no configurado');
    error.status = 503;
    throw error;
  }

  const nombre = String(
    firstDefined(input && input.nombre, input && input.name, input && input.nombreCompleto) || ''
  ).trim();
  const correo = String(
    firstDefined(
      input && input.correo,
      input && input.email,
      input && input.correoElectronico
    ) || ''
  ).trim();

  if (!nombre) {
    const error = new Error('El nombre es obligatorio');
    error.status = 400;
    throw error;
  }

  if (!correo) {
    const error = new Error('El correo es obligatorio');
    error.status = 400;
    throw error;
  }

  let sample = null;
  try {
    const current = await requestJson(CLIENTES_URL + '/clientes');
    sample = extractCollection(current)[0] || null;
  } catch {
    // La creación puede seguir funcionando aunque la consulta previa falle.
  }

  const candidates = [];

  function addCandidate(payload) {
    const signature = JSON.stringify(payload);
    if (!candidates.some((item) => JSON.stringify(item) === signature)) {
      candidates.push(payload);
    }
  }

  // Prioriza el esquema que ya usa el servicio si podemos inferirlo.
  if (sample && Object.prototype.hasOwnProperty.call(sample, 'email')) {
    addCandidate({ nombre, email: correo });
  }
  if (sample && Object.prototype.hasOwnProperty.call(sample, 'correo')) {
    addCandidate({ nombre, correo });
  }
  if (sample && Object.prototype.hasOwnProperty.call(sample, 'name')) {
    addCandidate({ name: nombre, email: correo });
  }

  // Compatibilidad con los formatos más comunes usados por los equipos.
  addCandidate({ nombre, correo });
  addCandidate({ nombre, email: correo });
  addCandidate({ name: nombre, email: correo });
  addCandidate({ nombreCompleto: nombre, correoElectronico: correo });

  let lastError = null;

  for (const payload of candidates) {
    try {
      return await requestJson(CLIENTES_URL + '/clientes', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    } catch (error) {
      lastError = error;

      // Solo prueba otra estructura si el servidor rechazó los datos.
      if (![400, 422].includes(error.status)) {
        throw error;
      }
    }
  }

  throw lastError || new Error('No fue posible crear el cliente');
}

function findInventoryRecord(payload, productoId) {
  if (!payload || typeof payload !== 'object') return null;

  const directId = inventoryProductId(payload);
  if (directId !== null && String(directId) === String(productoId)) {
    return payload;
  }

  if (
    payload.existencia !== undefined ||
    payload.stock !== undefined ||
    payload.cantidad !== undefined
  ) {
    return payload;
  }

  const collection = extractCollection(payload);
  return collection.find((item) =>
    String(inventoryProductId(item)) === String(productoId)
  ) || null;
}

async function getInventoryRecord(productoId) {
  if (!INVENTARIO_URL) return null;

  // Algunos equipos implementaron GET /inventario/:productoId.
  try {
    const direct = await requestJson(
      INVENTARIO_URL + '/inventario/' + encodeURIComponent(productoId)
    );
    const record = findInventoryRecord(direct, productoId);
    if (record) return record;
  } catch (error) {
    // 404/405 se resuelven intentando la colección completa.
    if (error.status && ![404, 405].includes(error.status)) {
      throw error;
    }
  }

  // Otros equipos solo exponen GET /inventario y regresan
  // { exito, total, datos: [...] }. Se normaliza aquí.
  const list = await requestJson(INVENTARIO_URL + '/inventario');
  const record = findInventoryRecord(list, productoId);

  if (!record) {
    const error = new Error('Producto ' + productoId + ' no encontrado en inventario');
    error.status = 404;
    error.data = list;
    throw error;
  }

  return record;
}

function extractPrice(producto) {
  if (!producto || typeof producto !== 'object') return null;

  return numberOrNull(firstDefined(
    producto.precio,
    producto.precio_unitario,
    producto.price,
    producto.data && producto.data.precio,
    producto.producto && producto.producto.precio,
    producto.producto && producto.producto.precio_unitario
  ));
}

function extractStock(inventario) {
  if (!inventario || typeof inventario !== 'object') return null;

  return numberOrNull(firstDefined(
    inventario.existencia,
    inventario.stock,
    inventario.cantidad,
    inventario.data && inventario.data.existencia,
    inventario.datos && !Array.isArray(inventario.datos) && inventario.datos.existencia,
    inventario.inventario && inventario.inventario.existencia,
    inventario.inventario && inventario.inventario.stock
  ));
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

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      ok: true,
      servicio: 'pedidos',
      puerto: PORT,
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
    res.status(503).json({ ok: false, servicio: 'pedidos', error: error.message });
  }
});

app.get('/pedidos', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM pedidos ORDER BY id DESC');
    res.json(result.rows);
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

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.post('/pedidos', async (req, res) => {
  const clienteId = Number(req.body.clienteId ?? req.body.cliente_id);
  const productoId = Number(req.body.productoId ?? req.body.producto_id);
  const cantidad = Number(req.body.cantidad);
  const metodoPago = String(req.body.metodoPago ?? req.body.metodo ?? 'tarjeta').trim();
  let precioUnitario = numberOrNull(req.body.precioUnitario ?? req.body.precio_unitario);

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
    try {
      pago = await requestJson(PAGOS_URL + '/pagos', {
        method: 'POST',
        body: JSON.stringify({
          pedidoId: Number(pedido.id),
          monto: total,
          metodo: metodoPago,
          origen: 'pedidos'
        })
      });
      integracion.pagoRegistrado = true;
      integracion.notificacionEnviada = Boolean(
        pago &&
        pago.integracion &&
        pago.integracion.notificacionEnviada
      );
    } catch (error) {
      pedido = await setPedidoState(pedido.id, 'PAGO_FALLIDO');
      return res.status(502).json({
        error: 'El pedido se creó, pero no fue posible registrar el pago',
        detalle: error.message,
        pedido,
        integracion
      });
    }

    const pagoId = numberOrNull(firstDefined(
      pago && pago.id,
      pago && pago.pago && pago.pago.id
    ));

    pedido = await setPedidoState(pedido.id, 'PAGADO', pagoId);

    if (INVENTARIO_URL && stockActual !== null) {
      const nuevaExistencia = stockActual - cantidad;

      try {
        await requestJson(INVENTARIO_URL + '/inventario/' + productoId, {
          method: 'PUT',
          body: JSON.stringify({
            existencia: nuevaExistencia,
            cantidad: nuevaExistencia,
            delta: -cantidad,
            pedidoId: Number(pedido.id)
          })
        });
        integracion.inventarioActualizado = true;
      } catch (error) {
        pedido = await setPedidoState(pedido.id, 'PAGADO_PENDIENTE_INVENTARIO', pagoId);
        return res.status(502).json({
          error: 'El pago fue aprobado, pero no fue posible actualizar inventario',
          detalle: error.message,
          pedido,
          pago,
          integracion
        });
      }
    }

    const advertenciaNotificacion =
      pago && pago.advertenciaNotificacion
        ? pago.advertenciaNotificacion
        : null;

    const finalResult = await pool.query('SELECT * FROM pedidos WHERE id = $1', [pedido.id]);

    res.status(201).json({
      pedido: finalResult.rows[0],
      pago,
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
 * El front se sirve desde :3003 y consume los otros equipos a través
 * de estas rutas para evitar problemas de CORS en el navegador.
 */
app.get('/gateway/status', async (req, res) => {
  const [clientes, productos, pagos, inventario, notificaciones] = await Promise.all([
    probeHttp(CLIENTES_URL ? CLIENTES_URL + '/clientes' : ''),
    probeHttp(PRODUCTOS_URL ? PRODUCTOS_URL + '/productos' : ''),
    probeHttp(PAGOS_URL + '/health'),
    probeHttp(INVENTARIO_URL ? INVENTARIO_URL + '/inventario' : ''),
    probeHttp(NOTIFICACIONES_URL ? NOTIFICACIONES_URL + '/notificaciones' : '')
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

app.get('/gateway/pagos', (req, res) =>
  gatewayRequest(res, PAGOS_URL, 'pagos', '/pagos')
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

app.get('/gateway/inventario', (req, res) =>
  gatewayRequest(res, INVENTARIO_URL, 'inventario', '/inventario')
);

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

app.put('/gateway/inventario/:productoId', (req, res) =>
  gatewayRequest(
    res,
    INVENTARIO_URL,
    'inventario',
    '/inventario/' + encodeURIComponent(req.params.productoId),
    {
      method: 'PUT',
      body: JSON.stringify(req.body)
    }
  )
);

app.get('/gateway/notificaciones', (req, res) =>
  gatewayRequest(res, NOTIFICACIONES_URL, 'notificaciones', '/notificaciones')
);

app.post('/gateway/notificaciones', (req, res) =>
  gatewayRequest(res, NOTIFICACIONES_URL, 'notificaciones', '/notificaciones', {
    method: 'POST',
    body: JSON.stringify(req.body)
  })
);

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

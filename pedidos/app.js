const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool, initDb } = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3003);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 5000);

const PAGOS_URL = normalizeBaseUrl(process.env.PAGOS_URL || 'http://pagos:3004');
const CLIENTES_URL = normalizeBaseUrl(process.env.CLIENTES_URL || '');
const PRODUCTOS_URL = normalizeBaseUrl(process.env.PRODUCTOS_URL || '');
const INVENTARIO_URL = normalizeBaseUrl(process.env.INVENTARIO_URL || '');
const NOTIFICACIONES_URL = normalizeBaseUrl(process.env.NOTIFICACIONES_URL || '');

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
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
      await requestJson(CLIENTES_URL + '/clientes/' + clienteId);
      integracion.clienteConsultado = true;
    }

    if (PRODUCTOS_URL) {
      const producto = await requestJson(PRODUCTOS_URL + '/productos/' + productoId);
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
      const inventario = await requestJson(INVENTARIO_URL + '/inventario/' + productoId);
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

    let advertenciaNotificacion = null;

    if (NOTIFICACIONES_URL) {
      try {
        await requestJson(NOTIFICACIONES_URL + '/notificaciones', {
          method: 'POST',
          body: JSON.stringify({
            tipo: 'PEDIDO_PAGADO',
            pedidoId: Number(pedido.id),
            mensaje: 'Pedido ' + pedido.id + ' pagado correctamente'
          })
        });
        integracion.notificacionEnviada = true;
      } catch (error) {
        advertenciaNotificacion = error.message;
      }
    }

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

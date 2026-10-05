const express = require('express');
const cors = require('cors');
const { pool, initDb } = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3004);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 5000);
const NOTIFICACIONES_URL = String(process.env.NOTIFICACIONES_URL || '').trim().replace(/\/+$/, '');

app.use(cors());
app.use(express.json({ limit: '1mb' }));

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

async function notifyApprovedPayment(pago) {
  if (!NOTIFICACIONES_URL || !pago) {
    return {
      notificacionEnviada: false,
      detalle: !NOTIFICACIONES_URL
        ? 'Servicio de notificaciones no configurado'
        : 'Pago no disponible para notificar'
    };
  }

  try {
    const notificacion = await requestJson(NOTIFICACIONES_URL + '/notificaciones', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'PAGO_APROBADO',
        pedidoId: Number(pago.pedido_id),
        mensaje:
          'Pago aprobado para el pedido ' +
          pago.pedido_id +
          ' por $' +
          Number(pago.monto).toFixed(2) +
          ' mediante ' +
          pago.metodo_pago
      })
    });

    return {
      notificacionEnviada: true,
      notificacion
    };
  } catch (error) {
    return {
      notificacionEnviada: false,
      detalle: error.message
    };
  }
}

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      ok: true,
      servicio: 'pagos',
      puerto: PORT,
      postgres: 'ok',
      notificaciones: {
        configurado: Boolean(NOTIFICACIONES_URL)
      }
    });
  } catch (error) {
    res.status(503).json({ ok: false, servicio: 'pagos', error: error.message });
  }
});

app.get('/pagos', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM pagos ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.get('/pagos/pedido/:pedidoId', async (req, res, next) => {
  try {
    const pedidoId = Number(req.params.pedidoId);

    if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
      return res.status(400).json({ error: 'pedidoId inválido' });
    }

    const result = await pool.query(
      'SELECT * FROM pagos WHERE pedido_id = $1',
      [pedidoId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Pago no encontrado para ese pedido' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get('/pagos/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'id inválido' });
    }

    const result = await pool.query('SELECT * FROM pagos WHERE id = $1', [id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.post('/pagos', async (req, res, next) => {
  try {
    const pedidoId = Number(req.body.pedidoId ?? req.body.pedido_id);
    const monto = Number(req.body.monto);
    const metodo = String(req.body.metodo ?? req.body.metodoPago ?? 'tarjeta').trim();

    if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
      return res.status(400).json({ error: 'pedidoId debe ser un entero mayor que 0' });
    }

    if (!Number.isFinite(monto) || monto <= 0) {
      return res.status(400).json({ error: 'monto debe ser mayor que 0' });
    }

    if (!metodo) {
      return res.status(400).json({ error: 'metodo no puede estar vacío' });
    }

    const referencia = 'PAGO-' + pedidoId + '-' + Date.now();

    const insert = await pool.query(
      `
        INSERT INTO pagos (
          pedido_id,
          monto,
          metodo_pago,
          estado,
          referencia
        )
        VALUES ($1, $2, $3, 'APROBADO', $4)
        ON CONFLICT (pedido_id) DO NOTHING
        RETURNING *
      `,
      [pedidoId, monto.toFixed(2), metodo, referencia]
    );

    let pago = insert.rows[0];

    if (!pago) {
      const existing = await pool.query(
        'SELECT * FROM pagos WHERE pedido_id = $1',
        [pedidoId]
      );
      pago = existing.rows[0];
    }

    const resultadoNotificacion = await notifyApprovedPayment(pago);

    return res.status(insert.rows.length ? 201 : 200).json({
      pago,
      integracion: {
        notificacionEnviada: resultadoNotificacion.notificacionEnviada
      },
      advertenciaNotificacion: resultadoNotificacion.notificacionEnviada
        ? null
        : resultadoNotificacion.detalle,
      notificacion: resultadoNotificacion.notificacionEnviada
        ? resultadoNotificacion.notificacion
        : null
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: 'Error interno del servicio pagos' });
});

async function start() {
  try {
    await initDb();
    app.listen(PORT, '0.0.0.0', () => {
      console.log('Servicio pagos escuchando en el puerto ' + PORT);
    });
  } catch (error) {
    console.error('No fue posible iniciar pagos:', error);
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

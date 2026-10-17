const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { pool, initDb } = require('./db');

const RUNNING_IN_DOCKER = fs.existsSync('/.dockerenv');

const app = express();
const PORT = Number(process.env.PORT || 3004);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 5000);
const NOTIFICACIONES_URL = normalizeServiceBaseUrl(process.env.NOTIFICACIONES_URL || '', 'notificaciones');

// Ruta canónica acordada en reglas.md y ruta heredada que aún usa el Equipo 3.
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
  if (RUNNING_IN_DOCKER) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        parsed.hostname = 'host.docker.internal';
        url = parsed.toString().replace(/\/$/, '');
      }
    } catch {
      // Si no es una URL válida se conserva para que el error real sea visible.
    }
  }

  return url;
}

function firstDefined() {
  for (const value of arguments) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
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

// Respuestas del Equipo 2: se conservan los nombres de columna y se agregan los
// alias en camelCase del contrato acordado (pedidoId, metodoPago, creadoEn).
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

async function notifyApprovedPayment(pago) {
  if (!NOTIFICACIONES_URL || !pago) {
    return {
      notificacionEnviada: false,
      detalle: !NOTIFICACIONES_URL
        ? 'Servicio de notificaciones no configurado'
        : 'Pago no disponible para notificar'
    };
  }

  // Se envían los dos vocabularios (español e inglés) para ser compatibles con
  // la versión canónica y con la versión heredada de Notificaciones del Equipo 3.
  const body = JSON.stringify({
    servicio: 'pagos', service: 'pagos',
    mensaje: 'Pago aprobado y compra realizada con éxito',
    message: 'Pago aprobado y compra realizada con éxito',
    tipo: 'success', type: 'success'
  });

  let lastError = null;

  for (const basePath of NOTIFICACIONES_PATHS) {
    try {
      const notificacion = await requestJson(NOTIFICACIONES_URL + basePath, {
        method: 'POST',
        body
      });

      return {
        notificacionEnviada: true,
        notificacion
      };
    } catch (error) {
      lastError = error;
      if (error.status && ![404, 405].includes(error.status)) {
        break;
      }
    }
  }

  return {
    notificacionEnviada: false,
    detalle: lastError ? lastError.message : 'No fue posible notificar el pago'
  };
}

app.get('/', (req, res) => res.json({
  servicio: 'pagos',
  equipo: 'Equipo 2 - Pedidos y Pagos',
  puertoInterno: PORT,
  contrato: {
    request: ['pedidoId', 'monto', 'metodo (o metodoPago)'],
    response: ['id', 'pedidoId', 'monto', 'metodoPago', 'estado', 'referencia', 'creadoEn']
  },
  integraciones: {
    notificaciones: NOTIFICACIONES_URL || null
  },
  endpoints: [
    'GET /health',
    'GET /',
    'GET /pagos',
    'GET /pagos/:id',
    'GET /pagos/pedido/:pedidoId',
    'POST /pagos'
  ]
}));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      ok: true,
      servicio: 'pagos',
      puertoInterno: PORT,
      postgres: 'ok',
      notificaciones: {
        configurado: Boolean(NOTIFICACIONES_URL)
      }
    });
  } catch (error) {
    res.status(503).json({ status: 'error', ok: false, servicio: 'pagos', error: error.message });
  }
});

app.get('/pagos', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM pagos ORDER BY id DESC');
    res.json(result.rows.map(serializePago));
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

    res.json(serializePago(result.rows[0]));
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

    res.json(serializePago(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.post('/pagos', async (req, res, next) => {
  try {
    const body = req.body || {};
    const pedidoId = Number(body.pedidoId ?? body.pedido_id);
    const monto = Number(body.monto);
    const metodo = String(body.metodo ?? body.metodoPago ?? 'tarjeta').trim();

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

    // Un pedido solo puede tener un pago: si ya existe se devuelve sin duplicar
    // ni generar otra notificación (idempotencia explícita, sin depender del driver).
    const existente = await pool.query('SELECT * FROM pagos WHERE pedido_id = $1', [pedidoId]);
    let pago = existente.rows[0] || null;
    let creado = false;

    if (!pago) {
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

      pago = insert.rows[0] || null;
      creado = Boolean(pago);

      if (!pago) {
        // Otra petición lo registró al mismo tiempo: se recupera el existente.
        const actual = await pool.query('SELECT * FROM pagos WHERE pedido_id = $1', [pedidoId]);
        pago = actual.rows[0];
      }
    }

    if (!creado) {
      return res.status(200).json({
        pago: serializePago(pago),
        integracion: {
          notificacionEnviada: false,
          pagoExistente: true
        },
        advertenciaNotificacion: null,
        notificacion: null
      });
    }

    const resultadoNotificacion = await notifyApprovedPayment(pago);

    return res.status(201).json({
      pago: serializePago(pago),
      integracion: {
        notificacionEnviada: resultadoNotificacion.notificacionEnviada,
        pagoExistente: false
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

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

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

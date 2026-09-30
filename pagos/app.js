const express = require('express');
const cors = require('cors');
const { pool, initDb } = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3004);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      ok: true,
      servicio: 'pagos',
      puerto: PORT,
      postgres: 'ok'
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

    if (insert.rows.length) {
      return res.status(201).json(insert.rows[0]);
    }

    const existing = await pool.query(
      'SELECT * FROM pagos WHERE pedido_id = $1',
      [pedidoId]
    );

    res.status(200).json(existing.rows[0]);
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

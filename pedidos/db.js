const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pedidos (
      id BIGSERIAL PRIMARY KEY,
      cliente_id BIGINT NOT NULL,
      producto_id BIGINT NOT NULL,
      cantidad INTEGER NOT NULL CHECK (cantidad > 0),
      precio_unitario NUMERIC(12, 2) NOT NULL CHECK (precio_unitario >= 0),
      total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
      estado VARCHAR(50) NOT NULL DEFAULT 'PENDIENTE_PAGO',
      pago_id BIGINT,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_id
    ON pedidos(cliente_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pedidos_producto_id
    ON pedidos(producto_id)
  `);
}

module.exports = { pool, initDb };

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pagos (
      id BIGSERIAL PRIMARY KEY,
      pedido_id BIGINT NOT NULL UNIQUE,
      monto NUMERIC(12, 2) NOT NULL CHECK (monto > 0),
      metodo_pago VARCHAR(40) NOT NULL,
      estado VARCHAR(30) NOT NULL DEFAULT 'APROBADO',
      referencia VARCHAR(120) NOT NULL UNIQUE,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pagos_pedido_id
    ON pagos(pedido_id)
  `);
}

module.exports = { pool, initDb };

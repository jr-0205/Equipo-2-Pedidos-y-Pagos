#!/usr/bin/env node
/*
 * configurar-ips.mjs — genera el archivo `.env` de este repositorio a partir de
 * `ip-path`, que es el ÚNICO archivo que hay que editar para conectar los cuatro
 * equipos entre sí.
 *
 *   1. Abre `ip-path` y escribe la IPv4 (o el nombre DNS) de cada computadora.
 *      Deja `auto` en los equipos que corren en ESTA computadora.
 *   2. Ejecuta:            node configurar-ips.mjs
 *   3. Levanta servicios:  docker compose up -d --build
 *
 * Opciones:
 *   --simular   muestra el .env resultante sin escribir nada.
 *   --probar    consulta /health de cada dirección para comprobar la red.
 *   --ip-path <ruta>
 *               usa otro archivo de direcciones (por ejemplo, el de la raíz del
 *               proyecto) en lugar del `ip-path` de este repositorio.
 *
 * El `.env` resultante es local y no se versiona: contiene las IP reales y las
 * contraseñas de esta computadora. `ip-path` tampoco debería versionarse con IP
 * reales; el `.gitignore` de cada repositorio ya protege el `.env`.
 *
 * Semántica de `auto`
 *   • Repositorios de los equipos 1, 2 y 3: `auto` se convierte en
 *     `host.docker.internal`, es decir, los contenedores alcanzan los puertos
 *     publicados en esta misma computadora.
 *   • Repositorio del front: `auto` deja la variable vacía, y el navegador usa el
 *     host desde el que se abrió la interfaz (funciona en cualquier PC de la red).
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RUTA_IP_PATH = path.join(AQUI, 'ip-path');
const RUTA_PLANTILLA = path.join(AQUI, '.env.example');
const RUTA_ENV = path.join(AQUI, '.env');

const AUTO = 'auto';
const HOST_DESDE_CONTENEDOR = 'host.docker.internal';

/** Los seis microservicios y el frontend: host, puerto y puerto publicado acordado. */
const SERVICIOS = [
  { nombre: 'clientes', host: 'EQUIPO1_HOST', puerto: 'CLIENTES_PORT', puertoPorDefecto: 2501 },
  { nombre: 'productos', host: 'EQUIPO1_HOST', puerto: 'PRODUCTOS_PORT', puertoPorDefecto: 2502 },
  { nombre: 'pedidos', host: 'EQUIPO2_HOST', puerto: 'PEDIDOS_PORT', puertoPorDefecto: 2503 },
  { nombre: 'pagos', host: 'EQUIPO2_HOST', puerto: 'PAGOS_PORT', puertoPorDefecto: 2504 },
  { nombre: 'inventario', host: 'EQUIPO3_HOST', puerto: 'INVENTARIO_PORT', puertoPorDefecto: 2506 },
  { nombre: 'notificaciones', host: 'EQUIPO3_HOST', puerto: 'NOTIFICACIONES_PORT', puertoPorDefecto: 2507 },
  { nombre: 'frontend', host: 'FRONTEND_HOST', puerto: 'FRONTEND_PORT', puertoPorDefecto: 2222 },
];

const CLAVES_HOST = ['EQUIPO1_HOST', 'EQUIPO2_HOST', 'EQUIPO3_HOST', 'FRONTEND_HOST'];

/* Valores de ejemplo que deben sustituirse por contraseñas reales. */
const PLANTILLA_SECRETO = /^(change_this|changeme|cambia_esto|tu_password$|password$)/i;

const IP_PATH_POR_DEFECTO = `# ip-path — única fuente de verdad de las direcciones de la demostración.
#
# Escribe la IPv4 (o el nombre DNS) de cada computadora. Ejemplo:
#     EQUIPO1_HOST=192.168.1.21
#     EQUIPO2_HOST=192.168.1.22
#     EQUIPO3_HOST=192.168.1.23
#     FRONTEND_HOST=192.168.1.21
#
# Deja \`auto\` en los equipos que corren en ESTA computadora.
#
# Después de editar este archivo ejecuta:  node configurar-ips.mjs
# El .env resultante es local y no se versiona.

EQUIPO1_HOST=auto
EQUIPO2_HOST=auto
EQUIPO3_HOST=auto
FRONTEND_HOST=auto
`;

const leer = ruta => (existsSync(ruta) ? readFileSync(ruta, 'utf8') : '');

/** Convierte un archivo `CLAVE=valor` en un mapa, ignorando comentarios. */
function aMapa(texto) {
  const mapa = new Map();
  for (const linea of texto.split(/\r?\n/)) {
    const coincidencia = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linea);
    if (coincidencia) mapa.set(coincidencia[1], coincidencia[2]);
  }
  return mapa;
}

/** `CLIENTES_URL`, `VITE_CLIENTES_URL`, `PRODUCTOS_URL`… → servicio del catálogo. */
function servicioDeLaClave(clave) {
  const nombre = clave.replace(/^VITE_/, '').replace(/_URL$/, '').toLowerCase();
  return SERVICIOS.find(servicio => servicio.nombre === nombre) || null;
}

const esAuto = valor => !valor || String(valor).trim().toLowerCase() === AUTO;

function urlDe(host, puerto) {
  if (!host) return '';
  const conPuerto = /:\d+$/.test(host) ? host : `${host}:${puerto}`;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(conPuerto) ? conPuerto : `http://${conPuerto}`;
}

function generar(plantilla, ipPath, envActual) {
  const esFront = /^VITE_/m.test(plantilla);

  const hosts = Object.fromEntries(CLAVES_HOST.map(clave => {
    const escrito = String(ipPath.get(clave) ?? AUTO).trim();
    if (!esAuto(escrito)) return [clave, escrito];
    return [clave, esFront ? '' : HOST_DESDE_CONTENEDOR];
  }));

  const puertos = Object.fromEntries(SERVICIOS.map(servicio => [
    servicio.puerto,
    Number(ipPath.get(servicio.puerto) || servicio.puertoPorDefecto),
  ]));

  const generadas = [];
  const secretos = [];

  const lineas = plantilla.split(/\r?\n/).map(linea => {
    const coincidencia = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linea);
    if (!coincidencia) return linea;

    const clave = coincidencia[1];

    if (CLAVES_HOST.includes(clave)) {
      return `${clave}=${String(ipPath.get(clave) ?? AUTO).trim() || AUTO}`;
    }

    if (SERVICIOS.some(servicio => servicio.puerto === clave)) {
      return `${clave}=${puertos[clave]}`;
    }

    const servicio = servicioDeLaClave(clave);
    if (servicio) {
      const url = urlDe(hosts[servicio.host], puertos[servicio.puerto]);
      generadas.push({ clave, url, servicio: servicio.nombre });
      return `${clave}=${url}`;
    }

    // Contraseñas y demás valores locales: se conservan los que ya existían y
    // solo se generan cuando la plantilla trae un marcador de posición.
    const previo = envActual.get(clave);
    let valor = previo !== undefined && previo !== '' ? previo : coincidencia[2];
    if (PLANTILLA_SECRETO.test(String(valor).trim())) {
      valor = randomBytes(18).toString('base64url');
      secretos.push(clave);
    }
    return `${clave}=${valor}`;
  });

  return { contenido: lineas.join('\n'), generadas, secretos, esFront };
}

async function probar(generadas) {
  console.log('\nComprobación de red (GET /health)');
  for (const { clave, url } of generadas) {
    if (!url) {
      console.log(`  omite   ${clave}: en modo auto el navegador resuelve el host`);
      continue;
    }
    if (url.includes(HOST_DESDE_CONTENEDOR)) {
      console.log(`  omite   ${clave}: ${HOST_DESDE_CONTENEDOR} solo resuelve dentro de Docker`);
      continue;
    }
    try {
      const respuesta = await fetch(`${url}/health`, { signal: AbortSignal.timeout(4000) });
      console.log(`  ${respuesta.ok ? 'OK   ' : 'FALLA '} ${clave} → ${url}/health (HTTP ${respuesta.status})`);
    } catch (error) {
      console.log(`  FALLA  ${clave} → ${url}/health (${error.message})`);
    }
  }
}

async function principal() {
  const argumentos = process.argv.slice(2);
  const banderas = new Set(argumentos);
  const simular = banderas.has('--simular') || banderas.has('--dry-run');

  // `--ip-path <ruta>` permite usar el catálogo de direcciones de la raíz del proyecto.
  const indice = argumentos.indexOf('--ip-path');
  const archivoDirecciones = indice !== -1 && argumentos[indice + 1]
    ? path.resolve(AQUI, argumentos[indice + 1])
    : RUTA_IP_PATH;

  if (!existsSync(RUTA_PLANTILLA)) {
    console.error(`No se encontró ${path.basename(RUTA_PLANTILLA)} en ${AQUI}.`);
    console.error('Este script debe ejecutarse dentro de un repositorio del proyecto.');
    process.exit(1);
  }

  if (!existsSync(archivoDirecciones)) {
    if (indice !== -1) {
      console.error(`No se encontró el archivo de direcciones: ${archivoDirecciones}`);
      process.exit(1);
    }
    writeFileSync(RUTA_IP_PATH, IP_PATH_POR_DEFECTO, 'utf8');
    console.log('Se creó `ip-path` con valores "auto" (todo en esta computadora).');
  }

  const plantilla = leer(RUTA_PLANTILLA);
  const ipPath = aMapa(leer(archivoDirecciones));
  const envActual = aMapa(leer(RUTA_ENV));

  const { contenido, generadas, secretos, esFront } = generar(plantilla, ipPath, envActual);

  if (simular) {
    console.log('--- .env que se generaría (no se escribió nada) ---\n');
    console.log(contenido);
    return;
  }

  const existiaEnv = existsSync(RUTA_ENV);
  let respaldo = false;
  if (existiaEnv) {
    // Red de seguridad: el .env anterior nunca se pierde.
    copyFileSync(RUTA_ENV, `${RUTA_ENV}.respaldo`);
    respaldo = true;
  }

  writeFileSync(RUTA_ENV, contenido, 'utf8');

  const escritos = [...ipPath.entries()].filter(([clave]) => CLAVES_HOST.includes(clave));
  const variosequipos = escritos.some(([, valor]) => !esAuto(valor));

  console.log(`${path.basename(AQUI)} → .env generado`);
  console.log(`  origen  : ip-path (${variosequipos ? 'varios equipos' : 'todo en esta computadora'})`);
  console.log(`  destino : ${path.relative(process.cwd(), RUTA_ENV) || '.env'}`);
  if (respaldo) console.log('  respaldo: .env.respaldo (copia del anterior, no se versiona)');

  console.log('\nDirecciones');
  for (const { clave, url } of generadas) {
    console.log(`  ${clave.padEnd(26)} ${url || '(auto: el navegador usa su propio host)'}`);
  }

  if (secretos.length) {
    console.log(`\nContraseñas nuevas: ${secretos.join(', ')}`);
    console.log('  (guárdalas: si borras el .env se generarán otras y la base de datos existente no coincidirá)');
  }

  console.log('\nSiguiente paso: docker compose up -d --build');
  if (esFront) console.log('El front se publica en el puerto 2222.');

  if (banderas.has('--probar')) await probar(generadas);
}

principal().catch(error => {
  console.error('Error al configurar las IP:', error.message);
  process.exit(1);
});

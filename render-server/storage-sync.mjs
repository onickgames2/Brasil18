// Backup dos uploads no Postgres.
// O disco do Render é apagado a cada deploy; este script guarda uma cópia dos arquivos
// no banco (tabela file_backup) e restaura tudo quando o container sobe de novo.
//
//   node storage-sync.mjs restore   -> baixa do banco os arquivos que faltam no disco
//   node storage-sync.mjs watch     -> a cada N segundos copia arquivos novos/alterados para o banco
//
// Variáveis (Render > Environment):
//   STORAGE_DATABASE_URL  (ou RENDER_DATABASE_URL)  postgresql://usuario:senha@host:5432/postgres
//   STORAGE_SYNC_DIRS         pastas separadas por vírgula (padrão abaixo)
//   STORAGE_SYNC_INTERVAL_MS  intervalo do ciclo, padrão 30000
//   STORAGE_SYNC_MAX_MB       tamanho máximo por arquivo, padrão 20
import fs from "fs";
import path from "path";
import pg from "pg";

const TAG = "[storage-sync]";
const MODE = process.argv[2] || "watch";
const DB_URL = process.env.STORAGE_DATABASE_URL || process.env.RENDER_DATABASE_URL;
const DIRS = (
  process.env.STORAGE_SYNC_DIRS ||
  "/app/storage,/app/public/images/thumbnails,/app/public/images/groups"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const INTERVAL_MS = Number(process.env.STORAGE_SYNC_INTERVAL_MS || 30000);
const MAX_BYTES = Number(process.env.STORAGE_SYNC_MAX_MB || 20) * 1024 * 1024;

if (!DB_URL) {
  console.warn(`${TAG} STORAGE_DATABASE_URL/RENDER_DATABASE_URL não definida: sem backup de arquivos`);
  process.exit(0);
}
try {
  const u = new URL(DB_URL);
  console.log(`${TAG} conectando em ${u.hostname}:${u.port || 5432} como ${decodeURIComponent(u.username)}`);
} catch {
  console.warn(`${TAG} string de conexão inválida`);
}

const pool = new pg.Pool({
  connectionString: DB_URL,
  max: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  ssl: { rejectUnauthorized: false },
});
pool.on("error", (e) => console.error(TAG, "db:", e.message));

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await pool.query(`
    create table if not exists file_backup (
      path text primary key,
      data bytea not null,
      size bigint not null,
      updated_at timestamptz not null default now()
    )`);
  tableReady = true;
}

function isInsideDirs(p) {
  const resolved = path.resolve(p);
  return DIRS.some((d) => resolved.startsWith(path.resolve(d) + path.sep));
}

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}

// ---------------- restore ----------------
async function restore() {
  await ensureTable();
  const { rows } = await pool.query("select path from file_backup order by path");
  let restored = 0;
  let present = 0;
  for (let i = 0; i < rows.length; i += 25) {
    const paths = rows
      .slice(i, i + 25)
      .map((r) => r.path)
      .filter(isInsideDirs);
    const missing = paths.filter((p) => !fs.existsSync(p));
    present += paths.length - missing.length;
    if (missing.length === 0) continue;
    const res = await pool.query("select path, data from file_backup where path = any($1)", [missing]);
    for (const row of res.rows) {
      fs.mkdirSync(path.dirname(row.path), { recursive: true });
      fs.writeFileSync(row.path, row.data);
      restored++;
    }
  }
  console.log(`${TAG} restauração concluída: ${restored} restaurados, ${present} já existiam (${rows.length} no banco)`);
}

// ---------------- watch ----------------
const known = new Map(); // caminho -> assinatura (tamanho:mtime) vista neste processo
const bigWarned = new Set();
let firstScan = true;
let dbSizes = new Map();

async function syncOnce() {
  await ensureTable();
  if (firstScan) {
    const { rows } = await pool.query("select path, size from file_backup");
    dbSizes = new Map(rows.map((r) => [r.path, Number(r.size)]));
  }

  const now = Date.now();
  let uploaded = 0;
  for (const dir of DIRS) {
    for (const file of walk(dir)) {
      let st;
      try {
        st = fs.statSync(file);
      } catch {
        continue;
      }
      const sig = `${st.size}:${Math.floor(st.mtimeMs)}`;
      if (known.get(file) === sig) continue;

      if (st.size > MAX_BYTES) {
        if (!bigWarned.has(file)) {
          bigWarned.add(file);
          console.warn(`${TAG} ignorando ${file} (${Math.round(st.size / 1048576)} MB, acima do limite)`);
        }
        known.set(file, sig);
        continue;
      }
      if (now - st.mtimeMs < 2000) continue; // ainda pode estar sendo escrito

      // Na primeira passada, arquivo que acabou de ser restaurado já está no banco
      if (firstScan && dbSizes.get(file) === st.size) {
        known.set(file, sig);
        continue;
      }

      let data;
      try {
        data = fs.readFileSync(file);
      } catch {
        continue;
      }
      await pool.query(
        `insert into file_backup (path, data, size) values ($1, $2, $3)
         on conflict (path) do update set data = excluded.data, size = excluded.size, updated_at = now()`,
        [file, data, st.size]
      );
      known.set(file, sig);
      uploaded++;
    }
  }

  // Arquivos que existiam e foram apagados: remove do backup.
  // Só considera arquivos que ESTE processo viu no disco e cuja pasta ainda existe.
  let removed = 0;
  for (const file of [...known.keys()]) {
    const root = DIRS.find((d) => path.resolve(file).startsWith(path.resolve(d) + path.sep));
    if (!root || !fs.existsSync(root)) continue;
    if (!fs.existsSync(file)) {
      await pool.query("delete from file_backup where path = $1", [file]);
      known.delete(file);
      removed++;
    }
  }

  firstScan = false;
  if (uploaded || removed) console.log(`${TAG} ciclo: ${uploaded} enviados, ${removed} removidos`);
}

let chain = Promise.resolve();
function runSync() {
  chain = chain.catch(() => {}).then(syncOnce);
  return chain;
}

async function watch() {
  console.log(`${TAG} monitorando: ${DIRS.join(", ")} (a cada ${INTERVAL_MS / 1000}s)`);
  const shutdown = async () => {
    try {
      await runSync(); // última cópia antes de desligar
    } catch (e) {
      console.error(TAG, "falha na cópia final:", e.message);
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  while (true) {
    try {
      await runSync();
    } catch (e) {
      console.error(TAG, "falha no ciclo:", e.message);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

if (MODE === "restore") {
  try {
    await restore();
  } catch (e) {
    console.error(TAG, "falha ao restaurar:", e.message);
    process.exitCode = 1;
  }
  await pool.end().catch(() => {});
} else {
  await watch();
}

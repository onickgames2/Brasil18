import express from "express";
import puppeteer from "puppeteer-core";
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.RENDER_PORT || 7832);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 2);
const CHROMIUM = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";

// Cores padrão do noob clássico
const DEFAULT_COLORS = {
  head: "#F5CD30",
  torso: "#0D69AC",
  leftArm: "#F5CD30",
  rightArm: "#F5CD30",
  leftLeg: "#A4BD47",
  rightLeg: "#A4BD47",
};

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/vendor/three", express.static(path.join(__dirname, "node_modules/three")));
app.use("/", express.static(path.join(__dirname, "public")));

// ---------- Tabela de cores (brickColorId -> hex) ----------
// Procura o avatar-colors.json em /app/JsonData (do backend) ou ao lado deste arquivo.
const COLORS_PATHS = [
  process.env.AVATAR_COLORS_PATH,
  path.join(__dirname, "..", "JsonData", "avatar-colors.json"),
  path.join(__dirname, "avatar-colors.json"),
].filter(Boolean);

const brickHex = new Map();
for (const p of COLORS_PATHS) {
  try {
    const list = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const c of list) brickHex.set(Number(c.brickColorId), String(c.hexColor).toUpperCase());
    console.log(`[render-server] ${brickHex.size} cores carregadas de ${p}`);
    break;
  } catch {
    // tenta o próximo caminho
  }
}
if (brickHex.size === 0) {
  console.warn("[render-server] avatar-colors.json não encontrado: todos os avatares usarão o noob padrão");
}

// ---------- Banco (só leitura das cores do avatar) ----------
// Defina RENDER_DATABASE_URL no Render, no formato:
//   postgresql://postgres.<ref>:<senha>@aws-0-us-east-1.pooler.supabase.com:5432/postgres
// Sem ela, o servidor usa o noob padrão (ou as cores que vierem no corpo da requisição).
const DB_URL = process.env.RENDER_DATABASE_URL;
const pool = DB_URL
  ? new pg.Pool({
      connectionString: DB_URL,
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: { rejectUnauthorized: false },
    })
  : null;
if (pool) pool.on("error", (e) => console.error("[db]", e.message));
else console.warn("[render-server] RENDER_DATABASE_URL não definida: sem cores reais dos usuários");

// Colunas da tabela user_avatar com o brickColorId de cada parte.
// Se o nome de alguma coluna for diferente no seu banco, é só mudar aqui.
const COLOR_COLUMNS = {
  head: "head_color_id",
  torso: "torso_color_id",
  leftArm: "left_arm_color_id",
  rightArm: "right_arm_color_id",
  leftLeg: "left_leg_color_id",
  rightLeg: "right_leg_color_id",
};

let lastDbWarn = 0;
async function fetchUserColors(userId) {
  if (!pool) return {};
  try {
    const cols = Object.values(COLOR_COLUMNS).join(", ");
    const r = await pool.query(`SELECT ${cols} FROM user_avatar WHERE user_id = $1 LIMIT 1`, [userId]);
    if (r.rows.length === 0) return {};
    const out = {};
    for (const [key, col] of Object.entries(COLOR_COLUMNS)) {
      const hex = brickHex.get(Number(r.rows[0][col]));
      if (hex) out[key] = hex;
    }
    return out;
  } catch (e) {
    if (Date.now() - lastDbWarn > 60000) {
      lastDbWarn = Date.now();
      console.error("[render-server] não consegui ler as cores do banco (usando o noob padrão):", e.message);
    }
    return {};
  }
}

// ---------- Browser (uma instância só, reaproveitada) ----------
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        executablePath: CHROMIUM,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--use-gl=angle",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
          "--ignore-gpu-blocklist",
        ],
      })
      .then((b) => {
        b.on("disconnected", () => {
          browserPromise = null;
          pagePromise = null;
        });
        return b;
      });
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

// ---------- Página de render (uma só, reaproveitada) ----------
// Assim o GLB, o pré-load e o cache do render.html valem para todas as requisições.
let pagePromise = null;
function getPage() {
  if (!pagePromise) {
    const promise = (async () => {
      const browser = await getBrowser();
      const page = await browser.newPage();
      page.on("pageerror", (e) => console.error("[page]", e.message));
      page.on("console", (m) => {
        if (m.type() === "error") console.error("[page.console]", m.text());
      });
      page.on("close", () => {
        if (pagePromise === promise) pagePromise = null;
      });
      await page.goto(`http://127.0.0.1:${PORT}/render.html`, { waitUntil: "load" });
      await page.waitForFunction("window.__ready === true || !!window.__error", { timeout: 30000 });
      const err = await page.evaluate(() => window.__error || null);
      if (err) {
        await page.close().catch(() => {});
        throw new Error("render.html não carregou: " + err);
      }
      return page;
    })();
    pagePromise = promise;
    promise.catch(() => {
      if (pagePromise === promise) pagePromise = null;
    });
  }
  return pagePromise;
}

// ---------- Fila simples pra limitar renders simultâneos ----------
let active = 0;
const waiting = [];
async function withSlot(fn) {
  if (active >= MAX_CONCURRENT) await new Promise((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    const next = waiting.shift();
    if (next) next();
  }
}

// ---------- Cores do avatar ----------
// Ordem de prioridade: cores enviadas no corpo da requisição > banco > noob padrão
const HEX = /^#[0-9a-fA-F]{6}$/;
async function getAvatarColors(userId, override) {
  const colors = { ...DEFAULT_COLORS, ...(await fetchUserColors(userId)) };
  if (override && typeof override === "object") {
    for (const key of Object.keys(colors)) {
      if (typeof override[key] === "string" && HEX.test(override[key])) {
        colors[key] = override[key];
      }
    }
  }
  return colors;
}

// Só aceita URLs http(s) para shirt/pants (templates 585x559, precisam de CORS)
const httpUrl = (v) => (typeof v === "string" && /^https?:\/\//i.test(v) ? v : null);

// ---------- Render ----------
async function renderScene(config) {
  const page = await getPage();
  try {
    const dataUrl = await page.evaluate((c) => window.renderAvatar(c), config);
    return dataUrl.replace(/^data:image\/png;base64,/, "");
  } catch (e) {
    // Se a página travou ou fechou, descarta pra próxima requisição abrir uma nova
    pagePromise = null;
    await page.close().catch(() => {});
    throw e;
  }
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function makeHandler(kind, defaultSize) {
  return async (req, res) => {
    const t0 = Date.now();
    try {
      const userId = Number(req.body?.userId);
      if (!Number.isFinite(userId)) {
        return res.status(400).json({ success: false, message: "userId inválido" });
      }
      const colors = await getAvatarColors(userId, req.body?.colors);
      const size = clamp(Number(req.body?.size) || defaultSize, 64, 1024);
      const shirt = httpUrl(req.body?.shirt);
      const pants = httpUrl(req.body?.pants);
      const data = await withSlot(() =>
        renderScene({ kind: kind === "headshot" ? "headshot" : "body", size, colors, shirt, pants })
      );
      console.log(`[render] ${kind} user=${userId} ${Date.now() - t0}ms`);
      res.json({ success: true, data }); // data = PNG em base64
    } catch (e) {
      console.error(`[render] ${kind} falhou:`, e);
      res.status(500).json({ success: false, message: String(e.message || e) });
    }
  };
}

// Rotas que o RenderingHandler.cs já chama
app.post("/player/thumbnail", makeHandler("avatar", 420));
app.post("/player/headshot", makeHandler("headshot", 150));

// Ainda não implementadas (próximos passos)
app.post("/player/thumbnail-3d", (req, res) =>
  res.status(501).json({ success: false, message: "thumbnail-3d ainda não implementado" })
);
app.post("*", (req, res) =>
  res.status(501).json({ success: false, message: `rota ${req.path} ainda não implementada` })
);

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[render-server] ouvindo na porta ${PORT}`);
  // Já abre o Chromium e a página, pra primeira requisição não esperar
  getPage()
    .then(() => console.log("[render-server] página de render pronta"))
    .catch((e) => console.error("[render-server] erro ao preparar a página:", e));
});

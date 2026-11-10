import express from "express";
import puppeteer from "puppeteer-core";
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildThumbnail3D } from "./thumb3d.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.RENDER_PORT || 7832);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 2);
const CHROMIUM = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";

// Backend (ASP.NET) roda na porta pública do Render, acessível por localhost
const BACKEND_PORT = Number(process.env.PORT || 10000);
// Modelo de URL pra baixar um asset pelo ID. {id} é trocado pelo número.
// Se o seu backend usar outra rota, defina ASSET_URL_TEMPLATE no Render.
const ASSET_URL_TEMPLATE =
  process.env.ASSET_URL_TEMPLATE || `http://127.0.0.1:${BACKEND_PORT}/asset/?id={id}`;

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

const httpUrl = (v) => (typeof v === "string" && /^https?:\/\//i.test(v) ? v : null);

// ---------- Render ----------
async function renderScene(config) {
  const page = await getPage();
  try {
    const dataUrl = await page.evaluate((c) => window.renderAvatar(c), config);
    return dataUrl.replace(/^data:image\/png;base64,/, "");
  } catch (e) {
    pagePromise = null;
    await page.close().catch(() => {});
    throw e;
  }
}

async function renderTextures3D(colors) {
  const page = await getPage();
  try {
    return await page.evaluate((c) => window.buildTextures3D({ colors: c }), colors);
  } catch (e) {
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
      res.json({ success: true, data });
    } catch (e) {
      console.error(`[render] ${kind} falhou:`, e);
      res.status(500).json({ success: false, message: String(e.message || e) });
    }
  };
}

// ---------- Imagens de assets (decal, face, camisa, calça, t-shirt) ----------
const MAX_ASSET_BYTES = 10 * 1024 * 1024;

function isImageBuffer(buf) {
  if (buf.length < 12) return false;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) return true;
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true;
  // WEBP (RIFF....WEBP)
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return true;
  return false;
}

// Baixa o asset; se vier um XML (Decal/Shirt/Pants/T-Shirt), segue o ID da imagem lá dentro
async function fetchAssetImage(assetId, depth = 0) {
  if (depth > 3) throw new Error("referência de asset profunda demais");
  const url = ASSET_URL_TEMPLATE.replace("{id}", String(assetId));
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: "follow" });
  if (!res.ok) throw new Error(`asset ${assetId} -> HTTP ${res.status} (${url})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_ASSET_BYTES) throw new Error(`asset ${assetId} grande demais`);
  if (isImageBuffer(buf)) return buf;

  const text = buf.toString("utf8");
  const m =
    text.match(/<url>[^<]*?id=(\d+)/i) ||
    text.match(/rbxassetid:\/\/(\d+)/i) ||
    text.match(/<url>[^<]*?\/(\d+)\s*<\/url>/i);
  if (!m) throw new Error(`asset ${assetId} não é imagem nem aponta pra uma`);
  const innerId = Number(m[1]);
  if (innerId === Number(assetId)) throw new Error(`asset ${assetId} aponta pra ele mesmo`);
  return fetchAssetImage(innerId, depth + 1);
}

function makeImageHandler(kind) {
  return async (req, res) => {
    const t0 = Date.now();
    try {
      const assetId = Number(req.body?.assetId);
      if (!Number.isFinite(assetId) || assetId <= 0) {
        return res.status(400).json({ success: false, message: "assetId inválido" });
      }
      const buf = await withSlot(() => fetchAssetImage(assetId));
      console.log(`[render] ${kind} asset=${assetId} ${buf.length}B ${Date.now() - t0}ms`);
      res.json({ success: true, data: buf.toString("base64") });
    } catch (e) {
      console.error(`[render] ${kind} falhou:`, e.message || e);
      res.status(500).json({ success: false, message: String(e.message || e) });
    }
  };
}

// Rotas que o RenderingHandler.cs já chama
app.post("/player/thumbnail", makeHandler("avatar", 420));
app.post("/player/headshot", makeHandler("headshot", 150));

app.post("/image/image", makeImageHandler("image"));
app.post("/image/clothing", makeImageHandler("clothing"));
app.post("/image/teeshirt", makeImageHandler("teeshirt"));

// Miniatura 3D
app.post("/player/thumbnail-3d", async (req, res) => {
  const t0 = Date.now();
  try {
    const userId = Number(req.body?.userId);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ success: false, message: "userId inválido" });
    }
    const colors = await getAvatarColors(userId, req.body?.colors);
    const textures = await withSlot(() => renderTextures3D(colors));
    const data = buildThumbnail3D(textures);
    console.log(`[render] avatar-3d user=${userId} ${Date.now() - t0}ms`);
    res.json({ success: true, data });
  } catch (e) {
    console.error("[render] avatar-3d falhou:", e);
    res.status(500).json({ success: false, message: String(e.message || e) });
  }
});

// Ainda não implementadas (próximos passos)
app.post("*", (req, res) =>
  res.status(501).json({ success: false, message: `rota ${req.path} ainda não implementada` })
);

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[render-server] ouvindo na porta ${PORT}`);
  console.log(`[render-server] assets via ${ASSET_URL_TEMPLATE}`);
  getPage()
    .then(() => console.log("[render-server] página de render pronta"))
    .catch((e) => console.error("[render-server] erro ao preparar a página:", e));
});

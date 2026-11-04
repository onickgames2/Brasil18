import express from "express";
import puppeteer from "puppeteer-core";
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
        });
        return b;
      });
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
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
// TODO: quando você me passar as colunas da tabela user_avatar, buscar aqui
// as cores reais do usuário. Por enquanto usa o noob padrão ou as cores do body.
const HEX = /^#[0-9a-fA-F]{6}$/;
async function getAvatarColors(userId, override) {
  const colors = { ...DEFAULT_COLORS };
  if (override && typeof override === "object") {
    for (const key of Object.keys(colors)) {
      if (typeof override[key] === "string" && HEX.test(override[key])) {
        colors[key] = override[key];
      }
    }
  }
  return colors;
}

// ---------- Render ----------
async function renderScene(config) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    page.on("pageerror", (e) => console.error("[page]", e.message));
    page.on("console", (m) => {
      if (m.type() === "error") console.error("[page.console]", m.text());
    });
    await page.setViewport({ width: config.size, height: config.size });
    await page.goto(`http://127.0.0.1:${PORT}/render.html`, { waitUntil: "load" });
    await page.waitForFunction("window.__ready === true", { timeout: 20000 });
    const dataUrl = await page.evaluate((c) => window.renderAvatar(c), config);
    return dataUrl.replace(/^data:image\/png;base64,/, "");
  } finally {
    await page.close().catch(() => {});
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
      const data = await withSlot(() => renderScene({ kind, size, colors }));
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
  getBrowser().catch((e) => console.error("[render-server] erro ao abrir Chromium:", e));
});

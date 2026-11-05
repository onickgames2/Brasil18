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

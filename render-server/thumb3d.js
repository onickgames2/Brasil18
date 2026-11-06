import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OBJ_PATH = path.join(__dirname, "models", "noob.obj");

// Qual parte do corpo é cada grupo (Rig1..Rig6) do noob.obj exportado do Roblox Studio.
// O boneco olha para -Z, então a direita dele é +X.
export const RIG_PARTS = {
  1: "RightLeg",
  2: "LeftLeg",
  3: "RightArm",
  4: "LeftArm",
  5: "Torso",
  6: "Head",
};

// Direção para onde o rosto aponta no OBJ (vetor unitário no plano XZ)
const FRONT = { x: 0, z: -1 };

const CAMERA_FOV = 70;
const CAMERA_AZIMUTH_DEG = 30; // gira a câmera um pouco para o lado
const CAMERA_ELEVATION_DEG = 8;

let cached = null;

// Lê o OBJ uma vez: renomeia os materiais para Player1..Player6
// (o visualizador 3D procura nomes no formato Player<N>) e calcula o AABB.
function loadModel() {
  if (cached) return cached;
  const lines = fs.readFileSync(OBJ_PATH, "utf8").split(/\r?\n/);
  const out = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (const line of lines) {
    if (line.startsWith("mtllib")) {
      out.push("mtllib scene.mtl");
      continue;
    }
    if (line.startsWith("usemtl")) continue; // substituído abaixo, logo após o "g"

    const g = /^g\s+Rig(\d+)/.exec(line);
    if (g) {
      out.push(line);
      out.push(`usemtl Player${g[1]}`);
      continue;
    }

    if (line.startsWith("v ")) {
      const p = line.trim().split(/\s+/).slice(1, 4).map(Number);
      for (let i = 0; i < 3; i++) {
        if (p[i] < min[i]) min[i] = p[i];
        if (p[i] > max[i]) max[i] = p[i];
      }
    }
    out.push(line);
  }

  cached = { obj: out.join("\n"), min, max };
  return cached;
}

function buildMtl() {
  const blocks = [];
  for (const n of Object.keys(RIG_PARTS)) {
    blocks.push(
      [
        `newmtl Player${n}`,
        "Ka 1 1 1",
        "Kd 1 1 1",
        "Ks 0 0 0",
        "d 1",
        "Ns 0",
        `map_Kd Player${n}Tex.png`,
        "",
      ].join("\n")
    );
  }
  return blocks.join("\n");
}

// Câmera no formato do JSON de miniatura 3D da Roblox
function buildCamera(min, max) {
  const center = min.map((m, i) => (m + max[i]) / 2);
  const height = max[1] - min[1];
  const dist = (height * 0.62) / Math.tan((CAMERA_FOV / 2) * (Math.PI / 180));

  const az = (CAMERA_AZIMUTH_DEG * Math.PI) / 180;
  const el = (CAMERA_ELEVATION_DEG * Math.PI) / 180;
  // gira a direção da frente em torno do eixo Y
  const fx = FRONT.x * Math.cos(az) + FRONT.z * Math.sin(az);
  const fz = -FRONT.x * Math.sin(az) + FRONT.z * Math.cos(az);

  const pos = {
    x: center[0] + fx * Math.cos(el) * dist,
    y: center[1] + Math.sin(el) * dist,
    z: center[2] + fz * Math.cos(el) * dist,
  };
  const dx = center[0] - pos.x;
  const dy = center[1] - pos.y;
  const dz = center[2] - pos.z;
  const len = Math.hypot(dx, dy, dz);

  return {
    position: pos,
    direction: { x: dx / len, y: dy / len, z: dz / len },
    fov: CAMERA_FOV,
  };
}

// textures: { Head, Torso, LeftArm, RightArm, LeftLeg, RightLeg } -> PNG em base64
// Devolve o JSON (texto) que o RedrawAvatar do backend espera.
export function buildThumbnail3D(textures) {
  const { obj, min, max } = loadModel();
  const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

  const files = {
    "scene.obj": { content: b64(obj) },
    "scene.mtl": { content: b64(buildMtl()) },
  };

  for (const [n, part] of Object.entries(RIG_PARTS)) {
    if (!textures[part]) throw new Error(`textura ausente para ${part}`);
    // o nome precisa conter "Tex.png" (o backend filtra por isso)
    files[`Player${n}Tex.png`] = { content: textures[part] };
  }

  const toXYZ = (a) => ({ x: a[0], y: a[1], z: a[2] });
  return JSON.stringify({
    camera: buildCamera(min, max),
    AABB: { min: toXYZ(min), max: toXYZ(max) },
    files,
  });
}

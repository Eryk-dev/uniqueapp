// lib/generation/bloco-png.ts
import sharp from 'sharp';
import { loadBlocoTemplate, type PackedFoto, type GenerateBlocoResult } from './bloco';

// Dimensões de saída baseadas na referência (assets/templates/bloco/bloco 17.04.png):
// 8505 × 13938 px a 400 DPI, com canal alfa.
const OUTPUT_WIDTH = 8505;
const OUTPUT_HEIGHT = 13938;
const OUTPUT_DPI = 400;

// viewBox do SVG source (lib/generation/bloco.ts usa mesmas coords).
// SVG_HEIGHT (=2508.66) bate com OUTPUT_HEIGHT/SCALE — não precisa constant.
const SVG_WIDTH = 1530.71;
const SCALE = OUTPUT_WIDTH / SVG_WIDTH; // ~5.5564

// Marcas de registro: 4 círculos vermelhos nos cantos do SVG (r=7.09).
// Cor #d40022 do próprio template.
const CORNER_RADIUS_SVG = 7.09;
const CORNER_COLOR = '#d40022';
const CORNER_POSITIONS_SVG: Array<{ x: number; y: number }> = [
  { x: 7.09, y: 7.09 },
  { x: 1523.62, y: 7.09 },
  { x: 7.09, y: 2501.57 },
  { x: 1523.62, y: 2501.57 },
];

export interface BlocoPngOutput {
  content: Buffer;
  filename: string;
  chapa_index: number;
}

export interface RenderBlocoPngsResult {
  pngs: BlocoPngOutput[];
  mapa: GenerateBlocoResult['mapa'];
}

/**
 * Gera um PNG por chapa no mesmo formato da referência (8505×13938, 400 DPI, alpha).
 *
 * Layout: bg transparente + 4 marcas de registro vermelhas nos cantos + fotos do cliente
 * nos slots preenchidos (stretch-to-fill).
 *
 * Slots vazios e contornos pretos NÃO são desenhados — o preto apareceria na impressão.
 *
 * Fotos são baixadas via fetch(public_url) e redimensionadas na hora.
 */
export async function renderBlocoPngs(
  packed: PackedFoto[],
  timestamp: string = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
): Promise<RenderBlocoPngsResult> {
  if (packed.length === 0) return { pngs: [], mapa: [] };

  const { slots } = loadBlocoTemplate();

  // Agrupar por chapa_index
  const byChapa = new Map<number, PackedFoto[]>();
  for (const p of packed) {
    if (!byChapa.has(p.chapa_index)) byChapa.set(p.chapa_index, []);
    byChapa.get(p.chapa_index)!.push(p);
  }

  // Pré-gera buffer do círculo vermelho (reutilizado nos 4 cantos de todas as chapas)
  const cornerRadiusPx = Math.round(CORNER_RADIUS_SVG * SCALE);
  const cornerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cornerRadiusPx * 2}" height="${cornerRadiusPx * 2}">
    <circle cx="${cornerRadiusPx}" cy="${cornerRadiusPx}" r="${cornerRadiusPx}" fill="${CORNER_COLOR}"/>
  </svg>`;
  const cornerBuf = await sharp(Buffer.from(cornerSvg)).png().toBuffer();

  const pngs: BlocoPngOutput[] = [];

  for (const [chapaIndex, chapaFotos] of Array.from(byChapa).sort((a, b) => a[0] - b[0])) {
    const composites: sharp.OverlayOptions[] = [];

    // Marcas de registro nos 4 cantos
    for (const c of CORNER_POSITIONS_SVG) {
      composites.push({
        input: cornerBuf,
        top: Math.round(c.y * SCALE - cornerRadiusPx),
        left: Math.round(c.x * SCALE - cornerRadiusPx),
      });
    }

    // Fotos em cada slot preenchido
    for (const foto of chapaFotos) {
      const slot = slots[foto.slot_index];
      if (!slot) continue;

      const x = Math.round(slot.x * SCALE);
      const y = Math.round(slot.y * SCALE);
      const w = Math.round(slot.width * SCALE);
      const h = Math.round(slot.height * SCALE);

      const res = await fetch(foto.public_url);
      if (!res.ok) {
        throw new Error(
          `Falha ao baixar foto ${foto.foto_id} (${foto.public_url}): HTTP ${res.status}`
        );
      }
      const photoBuf = Buffer.from(await res.arrayBuffer());

      // Redimensiona pra caber exato no slot (stretch-to-fill, sem preservar aspect)
      const resized = await sharp(photoBuf)
        .resize(w, h, { fit: 'fill' })
        .toBuffer();

      composites.push({ input: resized, top: y, left: x });
    }

    const outputBuffer = await sharp({
      create: {
        width: OUTPUT_WIDTH,
        height: OUTPUT_HEIGHT,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(composites)
      .withMetadata({ density: OUTPUT_DPI })
      .png()
      .toBuffer();

    pngs.push({
      content: outputBuffer,
      filename: `chapa_blocos_${chapaIndex + 1}_${timestamp}.png`,
      chapa_index: chapaIndex,
    });
  }

  const mapa = packed.map((p) => ({
    foto_id: p.foto_id,
    item_id: p.item_id,
    pedido_id: p.pedido_id,
    nf_id: p.nf_id,
    posicao: p.posicao,
    chapa_index: p.chapa_index,
    slot_index: p.slot_index,
    public_url: p.public_url,
  }));

  return { pngs, mapa };
}

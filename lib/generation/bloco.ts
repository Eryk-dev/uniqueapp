// lib/generation/bloco.ts
import fs from 'fs';
import { DOMParser } from '@xmldom/xmldom';
import { BLOCO_CONFIG } from './config';
import { parseSvg, serializeSvg } from './svg-engine';

/**
 * Slot coordenada no SVG template, após aplicação de todos os transforms.
 * Sistema de coordenadas: origem topo-esquerdo, y cresce pra baixo.
 */
export interface BlocoSlot {
  index: number;    // 0-29
  x: number;        // canto superior esquerdo (SVG units)
  y: number;
  width: number;    // 255.12 nominalmente
  height: number;   // 368.5 nominalmente
}

/**
 * Parser manual de "translate(a,b) rotate(-90)" que o template usa.
 * Aplica: primeiro rotate(-90), depois translate.
 * Em rotate(-90): (x,y) -> (y, -x)
 * Em translate(tx,ty): (x,y) -> (x+tx, y+ty)
 */
function transformRect(
  x: number, y: number, w: number, h: number,
  tx: number, ty: number
): { x: number; y: number; width: number; height: number } {
  // 4 corners no sistema local
  const corners = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ];
  // Aplicar rotate(-90) seguido de translate(tx, ty)
  const transformed = corners.map(([cx, cy]) => [cy! + tx, -cx! + ty]);
  const xs = transformed.map((p) => p[0]!);
  const ys = transformed.map((p) => p[1]!);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/**
 * Parseia os 30 rects com class="cls-2" do template e retorna slots ordenados.
 *
 * Ordenação: linha (y crescente) primeiro, depois coluna (x crescente) — leitura ocidental.
 */
export function parseBlocoSlots(svgContent: string): BlocoSlot[] {
  // xmldom não tem querySelectorAll; usa getElementsByTagName + manual filter
  const doc = new DOMParser().parseFromString(svgContent, 'image/svg+xml');
  const rects = Array.from(doc.getElementsByTagName('rect'));

  const slots: Array<Omit<BlocoSlot, 'index'>> = [];

  for (const rect of rects) {
    const cls = rect.getAttribute('class') ?? '';
    if (!cls.split(/\s+/).includes('cls-2')) continue;

    const x = parseFloat(rect.getAttribute('x') ?? '0');
    const y = parseFloat(rect.getAttribute('y') ?? '0');
    const w = parseFloat(rect.getAttribute('width') ?? '0');
    const h = parseFloat(rect.getAttribute('height') ?? '0');
    const transform = rect.getAttribute('transform') ?? '';

    // Match "translate(tx ty) rotate(-90)" ou "translate(tx, ty) rotate(-90)"
    const match = transform.match(/translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)\s*rotate\(\s*-90\s*\)/);
    if (!match) {
      // Rect sem transform esperado — ignora
      continue;
    }

    const tx = parseFloat(match[1]!);
    const ty = parseFloat(match[2]!);

    slots.push(transformRect(x, y, w, h, tx, ty));
  }

  // Ordenar: linha (y ~ 68.4, 479.15, ...) depois coluna (x ~ 27.34, 332.57, ...)
  // Tolerância na row grouping: slots na mesma "row" têm y dentro de ±50 unidades
  slots.sort((a, b) => {
    const rowDiff = a.y - b.y;
    if (Math.abs(rowDiff) > 50) return rowDiff;
    return a.x - b.x;
  });

  return slots.map((s, i) => ({ index: i, ...s }));
}

/**
 * Cache do template parseado pra evitar file read a cada chapa.
 */
let cachedTemplate: { content: string; slots: BlocoSlot[] } | null = null;

export function loadBlocoTemplate(): { content: string; slots: BlocoSlot[] } {
  if (cachedTemplate) return cachedTemplate;
  const content = fs.readFileSync(BLOCO_CONFIG.TEMPLATE_PATH, 'utf-8');
  const slots = parseBlocoSlots(content);
  if (slots.length !== BLOCO_CONFIG.SLOTS_PER_CHAPA) {
    throw new Error(
      `Template parser: expected ${BLOCO_CONFIG.SLOTS_PER_CHAPA} slots, got ${slots.length}`
    );
  }
  cachedTemplate = { content, slots };
  return cachedTemplate;
}

// Re-export util pros tests diagnosticos
export const __internal = { transformRect, parseBlocoSlots };

// ============================================================
// PACKING ALGORITHM
// ============================================================

export interface FotoToPlace {
  foto_id: string;
  item_id: string;
  pedido_id: string;
  nf_id: number;
  posicao: number;
  public_url: string;
}

export interface PackedFoto extends FotoToPlace {
  chapa_index: number;    // 0-based
  slot_index: number;     // 0-29 (posição na chapa)
}

/**
 * Distribui fotos em chapas de 30 slots.
 * Regras (spec seção 3):
 * - Ordena por nf_id ASC, pedido_id ASC, posicao ASC (caller deve passar já ordenado)
 * - Fotos do mesmo item nunca são split entre chapas diferentes
 * - Se um item não couber na chapa atual, começa uma nova chapa
 * - Slots vazios na chapa parcial não são alocados (chamador remove no render)
 */
export function packFotos(
  fotos: FotoToPlace[],
  slotsPerChapa: number = 30
): PackedFoto[] {
  // Agrupar por item_id preservando ordem (caller ordenou por nf_id, pedido_id, posicao)
  const groupedByItem = new Map<string, FotoToPlace[]>();
  for (const f of fotos) {
    if (!groupedByItem.has(f.item_id)) groupedByItem.set(f.item_id, []);
    groupedByItem.get(f.item_id)!.push(f);
  }

  const result: PackedFoto[] = [];
  let chapaIndex = 0;
  let nextSlot = 0;

  for (const [, itemFotos] of Array.from(groupedByItem)) {
    // Se o item não cabe na chapa atual, pula pra próxima
    if (nextSlot > 0 && nextSlot + itemFotos.length > slotsPerChapa) {
      chapaIndex++;
      nextSlot = 0;
    }
    for (const f of itemFotos) {
      result.push({
        ...f,
        chapa_index: chapaIndex,
        slot_index: nextSlot,
      });
      nextSlot++;
      if (nextSlot >= slotsPerChapa) {
        chapaIndex++;
        nextSlot = 0;
      }
    }
  }

  return result;
}

// ============================================================
// SVG RENDERER
// ============================================================

export interface BlocoSvgOutput {
  content: string;
  filename: string;
  chapa_index: number;
}

export interface GenerateBlocoResult {
  svgs: BlocoSvgOutput[];
  mapa: Array<{
    foto_id: string;
    item_id: string;
    pedido_id: string;
    nf_id: number;
    posicao: number;
    chapa_index: number;
    slot_index: number;
    public_url: string;
  }>;
}

/**
 * Gera um SVG por chapa com as fotos inseridas como <image>.
 * Slots vazios têm os <rect class="cls-2"> removidos.
 */
export function renderBlocoSvgs(
  packed: PackedFoto[],
  timestamp: string = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
): GenerateBlocoResult {
  if (packed.length === 0) {
    return { svgs: [], mapa: [] };
  }

  // Agrupar por chapa_index
  const byChapa = new Map<number, PackedFoto[]>();
  for (const p of packed) {
    if (!byChapa.has(p.chapa_index)) byChapa.set(p.chapa_index, []);
    byChapa.get(p.chapa_index)!.push(p);
  }

  const svgs: BlocoSvgOutput[] = [];
  const sortedChapas = Array.from(byChapa.entries()).sort((a, b) => a[0] - b[0]);

  for (const [chapaIndex, chapaFotos] of sortedChapas) {
    const usedSlots = new Set(chapaFotos.map((f) => f.slot_index));

    // Parse fresh copy do template pra esta chapa
    const doc = parseSvg(BLOCO_CONFIG.TEMPLATE_PATH);

    // Itera rects com class="cls-2" — os mesmos 30 que o parser identifica
    // Estratégia: mapeia <rect> DOM → slot computado, ordena igual parseBlocoSlots, então itera
    const allRects = Array.from(doc.getElementsByTagName('rect')) as Element[];
    const rectsWithSlots = allRects
      .filter((r) => (r.getAttribute('class') ?? '').split(/\s+/).includes('cls-2'))
      .map((rect) => {
        const x = parseFloat(rect.getAttribute('x') ?? '0');
        const y = parseFloat(rect.getAttribute('y') ?? '0');
        const w = parseFloat(rect.getAttribute('width') ?? '0');
        const h = parseFloat(rect.getAttribute('height') ?? '0');
        const transform = rect.getAttribute('transform') ?? '';
        const match = transform.match(/translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)\s*rotate\(\s*-90\s*\)/);
        if (!match) return null;
        const tx = parseFloat(match[1]!);
        const ty = parseFloat(match[2]!);
        const slot = transformRect(x, y, w, h, tx, ty);
        return { rect, slot };
      })
      .filter((x): x is { rect: Element; slot: { x: number; y: number; width: number; height: number } } => x !== null);

    // Ordena do mesmo jeito que parseBlocoSlots (linha depois coluna)
    rectsWithSlots.sort((a, b) => {
      const rowDiff = a.slot.y - b.slot.y;
      if (Math.abs(rowDiff) > 50) return rowDiff;
      return a.slot.x - b.slot.x;
    });

    // Para cada slot: se preenchido, insere <image> antes do <rect>;
    // se vazio, remove o <rect>
    rectsWithSlots.forEach((item, slotIdx) => {
      const foto = chapaFotos.find((f) => f.slot_index === slotIdx);
      if (foto) {
        // Criar <image> no mesmo parent do <rect>
        const imageEl = doc.createElementNS('http://www.w3.org/2000/svg', 'image');
        imageEl.setAttribute('x', String(item.slot.x));
        imageEl.setAttribute('y', String(item.slot.y));
        imageEl.setAttribute('width', String(item.slot.width));
        imageEl.setAttribute('height', String(item.slot.height));
        imageEl.setAttribute('preserveAspectRatio', 'none');
        imageEl.setAttribute('href', foto.public_url);
        item.rect.parentNode?.insertBefore(imageEl, item.rect);
        // Mantém o <rect> (stroke preto) como borda de corte sobre a imagem
      } else if (!usedSlots.has(slotIdx)) {
        // Slot vazio: remove rect
        item.rect.parentNode?.removeChild(item.rect);
      }
    });

    svgs.push({
      content: serializeSvg(doc),
      filename: `chapa_blocos_${chapaIndex + 1}_${timestamp}.svg`,
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

  return { svgs, mapa };
}

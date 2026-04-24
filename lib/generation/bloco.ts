// lib/generation/bloco.ts
import fs from 'fs';
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
  const { DOMParser } = require('@xmldom/xmldom');
  const doc = new DOMParser().parseFromString(svgContent, 'image/svg+xml');
  const rects = Array.from(doc.getElementsByTagName('rect')) as Element[];

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

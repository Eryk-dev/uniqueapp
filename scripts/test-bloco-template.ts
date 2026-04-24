// scripts/test-bloco-template.ts
/**
 * Gera 2 SVGs de exemplo pra conferência visual:
 *   tmp/bloco-cheio.svg   — 30 fotos placeholder (chapa completa)
 *   tmp/bloco-parcial.svg — 17 fotos placeholder (verifica remoção de slots vazios)
 *
 * Abrir no browser (ex: `open tmp/bloco-cheio.svg`) e verificar:
 *  - Quadrados coloridos nos 30 slots na ordem correta
 *  - Slots vazios não desenhados no bloco-parcial
 */
import fs from 'fs';
import path from 'path';
import { packFotos, renderBlocoSvgs, type FotoToPlace } from '../lib/generation/bloco';

const TMP_DIR = path.join(process.cwd(), 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

function placeholderDataUrl(label: string, colorIdx: number): string {
  const colors = ['#ff4444', '#44ff44', '#4488ff', '#ffaa22', '#aa44ff', '#ff44aa', '#22ddcc'];
  const color = colors[colorIdx % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 144">
    <rect width="100" height="144" fill="${color}"/>
    <text x="50" y="80" text-anchor="middle" font-size="20" fill="white" font-family="sans-serif">${label}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function makeFoto(n: number): FotoToPlace {
  return {
    foto_id: `f${n}`,
    item_id: `i${n}`,
    pedido_id: `p${n}`,
    nf_id: n,
    posicao: 1,
    public_url: placeholderDataUrl(String(n), n),
  };
}

// 30 fotos
{
  const fotos = Array.from({ length: 30 }, (_, i) => makeFoto(i + 1));
  const packed = packFotos(fotos);
  const { svgs } = renderBlocoSvgs(packed, '00000000000000');
  const outPath = path.join(TMP_DIR, 'bloco-cheio.svg');
  fs.writeFileSync(outPath, svgs[0]!.content);
  console.log(`  ✓ ${outPath}  (${svgs.length} SVG, chapa cheia)`);
}

// 17 fotos
{
  const fotos = Array.from({ length: 17 }, (_, i) => makeFoto(i + 1));
  const packed = packFotos(fotos);
  const { svgs } = renderBlocoSvgs(packed, '00000000000000');
  const outPath = path.join(TMP_DIR, 'bloco-parcial.svg');
  fs.writeFileSync(outPath, svgs[0]!.content);
  console.log(`  ✓ ${outPath}  (${svgs.length} SVG, chapa parcial — 17 slots preenchidos)`);
}

console.log('OK — abra os arquivos em tmp/ num browser pra conferência visual');

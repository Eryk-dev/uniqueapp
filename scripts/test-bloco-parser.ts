// scripts/test-bloco-parser.ts
/**
 * Valida que o parser acha 30 slots com coordenadas esperadas.
 * Rodar: npm run test:bloco-parser
 */
import assert from 'node:assert/strict';
import { loadBlocoTemplate } from '../lib/generation/bloco';
import { BLOCO_CONFIG } from '../lib/generation/config';

const { slots } = loadBlocoTemplate();

console.log(`Achou ${slots.length} slots`);

// 1. Quantidade
assert.equal(slots.length, BLOCO_CONFIG.SLOTS_PER_CHAPA, 'Should find 30 slots');

// 2. Dimensões — cada slot deve ser ~255.12 x 368.5 (depois da rotação)
for (const slot of slots) {
  assert.ok(
    Math.abs(slot.width - 255.12) < 0.5,
    `Slot ${slot.index} width=${slot.width} ~ 255.12`
  );
  assert.ok(
    Math.abs(slot.height - 368.5) < 0.5,
    `Slot ${slot.index} height=${slot.height} ~ 368.5`
  );
}

// 3. Ordenação — linha 1 (slots 0-4) tem y ~ 68.4
for (let i = 0; i < 5; i++) {
  assert.ok(
    Math.abs(slots[i]!.y - 68.4) < 1,
    `Slot ${i} deveria estar na linha 1 (y~68.4), tem y=${slots[i]!.y}`
  );
}

// 4. Primeira coluna (slots 0, 5, 10, 15, 20, 25) tem x ~ 27.34
for (const i of [0, 5, 10, 15, 20, 25]) {
  assert.ok(
    Math.abs(slots[i]!.x - 27.34) < 1,
    `Slot ${i} deveria estar na coluna 1 (x~27.34), tem x=${slots[i]!.x}`
  );
}

// 5. Linha 3 (slots 10-14) tem y ~ 877.85 (drift intencional de ~12 vs. padrão)
for (let i = 10; i < 15; i++) {
  assert.ok(
    Math.abs(slots[i]!.y - 877.85) < 1,
    `Slot ${i} deveria estar na linha 3 (y~877.85), tem y=${slots[i]!.y}`
  );
}

console.log('OK');

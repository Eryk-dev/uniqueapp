// scripts/test-bloco-packing.ts
/**
 * Valida o packing algorithm:
 * 1. 30 fotos em 10 pedidos × 3 fotos → 1 chapa cheia
 * 2. 33 fotos em 11 pedidos × 3 fotos → 2 chapas, pedido 11 contíguo na chapa 2
 * 3. 28 pedidos × 1 foto + 1 pedido × 3 fotos (31 total) → pedido de 3 fotos não divide, vai inteiro pra chapa 2
 * 4. 1 foto só
 * 5. Array vazio
 */
import assert from 'node:assert/strict';
import { packFotos, type FotoToPlace } from '../lib/generation/bloco';

function makeFoto(pedido: number, posicao: number): FotoToPlace {
  const nf = pedido; // uma NF por pedido
  return {
    foto_id: `foto-${pedido}-${posicao}`,
    item_id: `item-${pedido}`,           // 1 item por pedido
    pedido_id: `pedido-${pedido}`,
    nf_id: nf,
    posicao,
    public_url: `https://fake/${pedido}-${posicao}.jpg`,
  };
}

// Caso 1: 30 fotos, 10 pedidos × 3 fotos
{
  const fotos: FotoToPlace[] = [];
  for (let p = 1; p <= 10; p++) {
    for (let i = 1; i <= 3; i++) fotos.push(makeFoto(p, i));
  }
  const packed = packFotos(fotos);
  assert.equal(packed.length, 30);
  assert.equal(packed[0]!.chapa_index, 0);
  assert.equal(packed[0]!.slot_index, 0);
  assert.equal(packed[29]!.chapa_index, 0);
  assert.equal(packed[29]!.slot_index, 29);
  console.log('  ✓ caso 1: 30 fotos 1 chapa');
}

// Caso 2: 33 fotos, 11 pedidos × 3 fotos → 2 chapas, pedido 11 em chapa 2 slot 0-2
{
  const fotos: FotoToPlace[] = [];
  for (let p = 1; p <= 11; p++) {
    for (let i = 1; i <= 3; i++) fotos.push(makeFoto(p, i));
  }
  const packed = packFotos(fotos);
  assert.equal(packed.length, 33);
  assert.equal(packed[30]!.pedido_id, 'pedido-11');
  assert.equal(packed[30]!.chapa_index, 1);
  assert.equal(packed[30]!.slot_index, 0);
  assert.equal(packed[32]!.chapa_index, 1);
  assert.equal(packed[32]!.slot_index, 2);
  console.log('  ✓ caso 2: 33 fotos 2 chapas, último pedido contíguo');
}

// Caso 3: 28 fotos + pedido com 3 fotos (31 total) → 28 na chapa 1 + 3 na chapa 2 (pedido não splitta)
{
  const fotos: FotoToPlace[] = [];
  for (let p = 1; p <= 28; p++) fotos.push(makeFoto(p, 1)); // 28 pedidos × 1 foto
  // Pedido 29 com 3 fotos
  for (let i = 1; i <= 3; i++) fotos.push(makeFoto(29, i));

  const packed = packFotos(fotos);
  assert.equal(packed.length, 31);
  assert.equal(packed[27]!.chapa_index, 0);
  assert.equal(packed[27]!.slot_index, 27);
  assert.equal(packed[28]!.pedido_id, 'pedido-29');
  assert.equal(packed[28]!.chapa_index, 1);
  assert.equal(packed[28]!.slot_index, 0);
  assert.equal(packed[30]!.chapa_index, 1);
  assert.equal(packed[30]!.slot_index, 2);
  console.log('  ✓ caso 3: pedido de 3 fotos não splitta, vai pra chapa seguinte');
}

// Caso 4: 1 foto só
{
  const packed = packFotos([makeFoto(1, 1)]);
  assert.equal(packed.length, 1);
  assert.equal(packed[0]!.chapa_index, 0);
  assert.equal(packed[0]!.slot_index, 0);
  console.log('  ✓ caso 4: 1 foto única');
}

// Caso 5: array vazio
{
  const packed = packFotos([]);
  assert.equal(packed.length, 0);
  console.log('  ✓ caso 5: array vazio');
}

console.log('OK');

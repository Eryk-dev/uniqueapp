import { generateNF, fetchOrder, setMarkers, setNFMarkers } from './client';

/**
 * O Tiny recusa `POST /pedidos/{id}/gerar-nota-fiscal` com 409 quando o pedido
 * ja tem NF. Desde 09/09/2026 isso virou rotina: uma automacao da conta passou
 * a emitir a NF no instante em que o pedido do Shopify e' importado, entao o
 * worker sempre chega depois. A NF que ja esta la e' a mesma que emitiriamos
 * (mesmo pedido, valor cheio) — adotar e' o certo; tratar como erro deixava o
 * pedido preso em `erro_fiscal` e fora do Gerar Molde.
 */
function isNFJaExiste(err: unknown): boolean {
  return err instanceof Error && err.message.includes('→ 409:');
}

export async function generateNFForOrder(tinyPedidoId: number): Promise<{
  nfId: number;
  /** true quando a NF ja existia no Tiny e foi adotada em vez de emitida. */
  adotada: boolean;
}> {
  try {
    const result = await generateNF(tinyPedidoId);
    return { nfId: result.id, adotada: false };
  } catch (err) {
    if (!isNFJaExiste(err)) throw err;

    // 409 sem NF no pedido (idNotaFiscal = 0) e' outro conflito qualquer —
    // nao ha o que adotar, propaga o erro original.
    const { idNotaFiscal } = await fetchOrder(tinyPedidoId);
    if (!idNotaFiscal) throw err;

    return { nfId: idNotaFiscal, adotada: true };
  }
}

export async function applyNFMarkers(
  tinyPedidoId: number,
  tinyNfId: number,
  markerLabel: string
) {
  await setMarkers(tinyPedidoId, [markerLabel]);
  await setNFMarkers(tinyNfId, [markerLabel]);
}

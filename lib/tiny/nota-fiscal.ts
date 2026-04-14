import { generateNF, setMarkers, setNFMarkers } from './client';

export async function generateNFForOrder(tinyPedidoCloneId: number): Promise<{
  nfId: number;
}> {
  const result = await generateNF(tinyPedidoCloneId);
  return { nfId: result.id };
}

export async function applyNFMarkers(
  originalTinyPedidoId: number,
  clonedTinyPedidoId: number,
  tinyNfId: number,
  markerLabel: string
) {
  await setMarkers(originalTinyPedidoId, [markerLabel]);
  await setMarkers(clonedTinyPedidoId, [markerLabel]);
  await setNFMarkers(tinyNfId, [markerLabel]);
}

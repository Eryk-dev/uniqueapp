import { generateNF, setMarkers, setNFMarkers } from './client';

export async function generateNFForOrder(tinyPedidoId: number): Promise<{
  nfId: number;
}> {
  const result = await generateNF(tinyPedidoId);
  return { nfId: result.id };
}

export async function applyNFMarkers(
  tinyPedidoId: number,
  tinyNfId: number,
  markerLabel: string
) {
  await setMarkers(tinyPedidoId, [markerLabel]);
  await setNFMarkers(tinyNfId, [markerLabel]);
}

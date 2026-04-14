import { generateNF, setMarker } from './client';

export async function generateNFForOrder(tinyPedidoCloneId: number): Promise<{
  nfId: number;
}> {
  const response = await generateNF(tinyPedidoCloneId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const retorno = response.retorno as any;

  const registros = retorno.registros;
  const registro = Array.isArray(registros) ? registros[0]?.registro : registros?.registro;

  if (!registro?.id) {
    throw new Error(`Failed to generate NF: ${JSON.stringify(retorno)}`);
  }

  return { nfId: registro.id };
}

export async function applyNFMarkers(
  originalTinyPedidoId: number,
  clonedTinyPedidoId: number,
  tinyNfId: number,
  markerId: number
) {
  await setMarker('pedido', originalTinyPedidoId, markerId);
  await setMarker('pedido', clonedTinyPedidoId, markerId);
  await setMarker('nota.fiscal', tinyNfId, markerId);
}

import { fetchOrder, createOrder, setMarkers, setNFMarkers } from './client';

const FISCAL_RATE = 0.38;
const MIN_VALUE = 0.01;

function cloneItemsAt38Percent(items: Array<{
  produto: { id: number; sku: string; descricao: string };
  quantidade: number;
  valorUnitario: number;
}>) {
  return items.map((i) => {
    let valor = i.valorUnitario * FISCAL_RATE;
    if (i.valorUnitario === 0) {
      valor = MIN_VALUE;
    } else if (valor < MIN_VALUE) {
      valor = MIN_VALUE;
    }
    valor = Math.round(valor * 100) / 100;

    return {
      produto: { id: i.produto.id },
      quantidade: i.quantidade,
      valorUnitario: valor,
    };
  });
}

function calculateDiscount(originalDiscount: number | undefined): number {
  if (!originalDiscount || originalDiscount <= 0) return 0;
  const discounted = originalDiscount * FISCAL_RATE;
  return Math.max(MIN_VALUE, Math.round(discounted * 100) / 100);
}

export async function duplicateOrderForFiscal(tinyPedidoId: number): Promise<{
  clonedOrderId: number;
  clonedOrderNumber: number;
}> {
  const pedido = await fetchOrder(tinyPedidoId);

  const clonedItems = cloneItemsAt38Percent(pedido.itens);
  const clonedDiscount = calculateDiscount(pedido.valorDesconto);

  const result = await createOrder({
    cliente: { id: pedido.cliente.id },
    data: pedido.data,
    itens: clonedItems,
    valorFrete: 0,
    valorDesconto: clonedDiscount,
    observacoesInternas: `NF 1/2 - Pedido original: ${pedido.numeroPedido} (${tinyPedidoId})`,
    ...(pedido.enderecoEntrega && { enderecoEntrega: pedido.enderecoEntrega }),
  });

  return {
    clonedOrderId: result.id,
    clonedOrderNumber: result.numeroPedido,
  };
}

export async function applyFiscalMarkers(
  originalOrderId: number,
  clonedOrderId: number,
  nfId: number,
  markerLabel: string
) {
  await setMarkers(originalOrderId, [markerLabel]);
  await setMarkers(clonedOrderId, [markerLabel]);
  if (nfId) {
    await setNFMarkers(nfId, [markerLabel]);
  }
}

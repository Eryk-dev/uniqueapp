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

  // Build transportador from original order
  const transportador: {
    id?: number;
    formaEnvio?: { id: number };
    formaFrete?: { id: number };
  } = {};
  if (pedido.transportador?.id) transportador.id = pedido.transportador.id;
  if (pedido.transportador?.formaEnvio?.id) transportador.formaEnvio = { id: pedido.transportador.formaEnvio.id };
  if (pedido.transportador?.formaFrete?.id) transportador.formaFrete = { id: pedido.transportador.formaFrete.id };

  const result = await createOrder({
    idContato: pedido.cliente.id,
    data: pedido.data,
    itens: clonedItems,
    valorFrete: 0,
    valorDesconto: clonedDiscount,
    observacoesInternas: `NF 1/2 - Pedido original: ${pedido.numeroPedido} (${tinyPedidoId})`,
    ...(Object.keys(transportador).length > 0 && { transportador }),
    ...(pedido.enderecoEntrega && {
      enderecoEntrega: {
        endereco: pedido.enderecoEntrega.endereco,
        enderecoNro: pedido.enderecoEntrega.numero,
        complemento: pedido.enderecoEntrega.complemento,
        bairro: pedido.enderecoEntrega.bairro,
        cep: pedido.enderecoEntrega.cep,
        municipio: pedido.enderecoEntrega.municipio,
        uf: pedido.enderecoEntrega.uf,
        ...(pedido.enderecoEntrega.nomeDestinatario && {
          nomeDestinatario: pedido.enderecoEntrega.nomeDestinatario,
        }),
        ...(pedido.enderecoEntrega.cpfCnpj && {
          cpfCnpj: pedido.enderecoEntrega.cpfCnpj,
        }),
        ...(pedido.enderecoEntrega.tipoPessoa && {
          tipoPessoa: pedido.enderecoEntrega.tipoPessoa,
        }),
        ...(pedido.enderecoEntrega.telefone && {
          fone: pedido.enderecoEntrega.telefone,
        }),
        ...(pedido.enderecoEntrega.inscricaoEstadual && {
          ie: pedido.enderecoEntrega.inscricaoEstadual,
        }),
      },
    }),
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

import { fetchOrder, createOrder, setMarkers, setNFMarkers } from './client';
import { DEFAULT_SHIPPING, hasFreteConfigurado } from './shipping';

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

  // Build transportador from original order. Quando o pedido original nao tem
  // frete (formaFrete ausente), aplica Loggi Econômica como default — senao a
  // NF sai sem frete e o agrupamento Tiny vira "Sem frete" (sem etiqueta).
  const transportador: {
    id?: number;
    formaEnvio?: { id: number };
    formaFrete?: { id: number };
  } = hasFreteConfigurado(pedido.transportador)
    ? {
        ...(pedido.transportador?.id && { id: pedido.transportador.id }),
        ...(pedido.transportador?.formaEnvio?.id && {
          formaEnvio: { id: pedido.transportador.formaEnvio.id },
        }),
        formaFrete: { id: pedido.transportador!.formaFrete!.id },
      }
    : {
        id: DEFAULT_SHIPPING.transportadorId,
        formaEnvio: { id: DEFAULT_SHIPPING.formaEnvio.id },
        formaFrete: { id: DEFAULT_SHIPPING.formaFrete.id },
      };

  const result = await createOrder({
    idContato: pedido.cliente.id,
    data: pedido.data,
    itens: clonedItems,
    valorFrete: 0,
    valorDesconto: clonedDiscount,
    observacoesInternas: `NF 1/2 - Pedido original: ${pedido.numeroPedido} (${tinyPedidoId})`,
    transportador,
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

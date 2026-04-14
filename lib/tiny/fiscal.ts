import { fetchOrder, createOrder, setMarker } from './client';

const FISCAL_RATE = 0.38;
const MIN_VALUE = 0.01;

interface TinyOrderItem {
  item: {
    descricao: string;
    unidade: string;
    quantidade: number;
    valor_unitario: number;
    codigo?: string;
  };
}

interface TinyOrderData {
  pedido: {
    id: number;
    numero: number;
    data_pedido: string;
    cliente: { codigo: number; nome: string };
    itens: TinyOrderItem[];
    valor_frete?: number;
    valor_desconto?: number;
    obs?: string;
    obs_interna?: string;
    endereco_entrega?: {
      endereco: string;
      numero: string;
      complemento: string;
      bairro: string;
      cep: string;
      cidade: string;
      uf: string;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
}

function cloneAt38Percent(items: TinyOrderItem[]): TinyOrderItem[] {
  return items.map((i) => {
    let valor = i.item.valor_unitario * FISCAL_RATE;
    if (i.item.valor_unitario === 0) {
      valor = MIN_VALUE;
    } else if (valor < MIN_VALUE) {
      valor = MIN_VALUE;
    }
    valor = Math.round(valor * 100) / 100;

    return {
      item: {
        ...i.item,
        valor_unitario: valor,
      },
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
  // Fetch original order
  const response = await fetchOrder(tinyPedidoId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const retorno = response.retorno as any;
  const original: TinyOrderData = retorno.registros
    ? retorno.registros[0] ?? retorno.registros
    : retorno.pedido
      ? { pedido: retorno.pedido }
      : retorno;

  const pedido = original.pedido;

  // Clone items at 38% value
  const clonedItems = cloneAt38Percent(pedido.itens);

  // Calculate discount at 38%
  const clonedDiscount = calculateDiscount(pedido.valor_desconto);

  // Map enderecoNro correctly
  const endereco = pedido.endereco_entrega;

  // Build cloned order
  const clonedOrder = {
    pedido: {
      cliente: { codigo: pedido.cliente.codigo },
      data_pedido: pedido.data_pedido,
      itens: clonedItems,
      valor_frete: 0,
      valor_desconto: clonedDiscount,
      obs_interna: `NF 1/2 - Pedido original: ${pedido.numero} (${tinyPedidoId})`,
      ...(endereco && {
        endereco_entrega: {
          endereco: endereco.endereco,
          numero: endereco.numero,
          complemento: endereco.complemento,
          bairro: endereco.bairro,
          cep: endereco.cep,
          cidade: endereco.cidade,
          uf: endereco.uf,
        },
      }),
    },
  };

  // Create cloned order in Tiny
  const createResponse = await createOrder(clonedOrder);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createRetorno = createResponse.retorno as any;

  const registros = createRetorno.registros;
  const registro = Array.isArray(registros) ? registros[0]?.registro : registros?.registro;

  if (!registro?.id) {
    throw new Error(`Failed to create cloned order: ${JSON.stringify(createRetorno)}`);
  }

  return {
    clonedOrderId: registro.id,
    clonedOrderNumber: registro.numero ?? 0,
  };
}

export async function applyFiscalMarkers(
  originalOrderId: number,
  clonedOrderId: number,
  nfId: number,
  markerId: number
) {
  // Apply marker to original order, cloned order, and NF
  await setMarker('pedido', originalOrderId, markerId);
  await setMarker('pedido', clonedOrderId, markerId);
  if (nfId) {
    await setMarker('nota.fiscal', nfId, markerId);
  }
}

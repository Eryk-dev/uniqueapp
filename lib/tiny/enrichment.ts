import { fetchNF, fetchOrder } from './client';
import { createServerClient } from '@/lib/supabase/server';

const KIT_SURPRESA_PRODUCT_ID = 848567371;

interface EnrichmentResult {
  items: Array<{
    modelo: string;
    molde: string | null;
    fonte: string | null;
    personalizacao: string | null;
    has_personalizacao: boolean;
    tiny_nf_id: number;
    numero_nf: number;
  }>;
  nomeCliente: string | null;
  formaFrete: string | null;
  idFormaEnvio: number | null;
  idFormaFrete: number | null;
  idTransportador: number | null;
}

function parseSKU(sku: string | undefined, linhaProduto: string): { molde: string | null; fonte: string | null } {
  if (!sku || linhaProduto !== 'uniquekids') return { molde: null, fonte: null };

  // SKU format: XX-XX-XX-MOLDE-XX-FONTE-...
  // Position 6 (0-indexed from split) = mold, position 8 = font
  const parts = sku.split('-');
  const molde = parts[5]?.trim() || null; // position 6 (0-indexed)
  const fonte = parts[7]?.trim() || null; // position 8

  return { molde, fonte };
}

function parsePersonalization(
  infoAdicional: string | undefined,
  linhaProduto: string
): string | null {
  if (!infoAdicional) return null;

  if (linhaProduto === 'uniquebox') {
    // For UniqueBox, infoAdicional IS the personalization
    // Empty infoAdicional = upload-only order
    return infoAdicional.trim() || null;
  }

  // For UniqueKids, personalization is in NOME (PERSONAL) field
  return infoAdicional.trim() || null;
}

export async function enrichOrder(
  pedidoId: string,
  tinyNfId: number,
  tinyPedidoId: number,
  linhaProduto: string
): Promise<EnrichmentResult> {
  // Fetch NF details
  const nfResponse = await fetchNF(tinyNfId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nfRetorno = nfResponse.retorno as any;
  const nfData = nfRetorno.nota_fiscal ?? nfRetorno.registros?.[0]?.nota_fiscal ?? {};

  const numeroNf = nfData.numero ?? 0;

  // Fetch original order details
  const orderResponse = await fetchOrder(tinyPedidoId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orderRetorno = orderResponse.retorno as any;
  const orderData = orderRetorno.pedido ?? orderRetorno.registros?.[0]?.pedido ?? {};

  const nomeCliente = orderData.cliente?.nome ?? null;
  const formaFrete = orderData.nome_transportador ?? orderData.forma_frete ?? null;
  const idFormaEnvio = orderData.id_forma_envio ?? null;
  const idFormaFrete = orderData.id_forma_frete ?? null;
  const idTransportador = orderData.id_transportador ?? null;

  // Process items and expand multi-quantity
  const items: EnrichmentResult['items'] = [];
  const orderItems = orderData.itens ?? [];

  for (const entry of orderItems) {
    const item = entry.item ?? entry;
    const quantidade = item.quantidade ?? 1;
    const sku = item.codigo;
    const descricao = item.descricao ?? '';
    const infoAdicional = item.informacoes_adicionais ?? item.descricao_complementar ?? '';

    // Skip Kit Surpresa
    if (item.id_produto === KIT_SURPRESA_PRODUCT_ID) continue;

    const { molde, fonte } = parseSKU(sku, linhaProduto);
    const personalizacao = parsePersonalization(infoAdicional, linhaProduto);
    const hasPerson = linhaProduto === 'uniquebox'
      ? !!personalizacao
      : molde !== 'PD' && fonte !== 'TD';

    // Expand multi-quantity items
    for (let i = 0; i < quantidade; i++) {
      items.push({
        modelo: descricao,
        molde,
        fonte,
        personalizacao,
        has_personalizacao: hasPerson,
        tiny_nf_id: tinyNfId,
        numero_nf: numeroNf,
      });
    }
  }

  return {
    items,
    nomeCliente,
    formaFrete,
    idFormaEnvio,
    idFormaFrete,
    idTransportador,
  };
}

export async function saveEnrichmentResults(
  pedidoId: string,
  result: EnrichmentResult
) {
  const supabase = createServerClient();

  // Update pedido with enriched data
  await supabase
    .from('pedidos')
    .update({
      nome_cliente: result.nomeCliente,
      forma_frete: result.formaFrete,
      id_forma_envio: result.idFormaEnvio,
      id_forma_frete: result.idFormaFrete,
      id_transportador: result.idTransportador,
      status: 'pronto_producao',
    })
    .eq('id', pedidoId);

  // Insert itens_producao
  if (result.items.length > 0) {
    await supabase.from('itens_producao').insert(
      result.items.map((item) => ({
        pedido_id: pedidoId,
        modelo: item.modelo,
        molde: item.molde,
        fonte: item.fonte,
        personalizacao: item.personalizacao,
        has_personalizacao: item.has_personalizacao,
        tiny_nf_id: item.tiny_nf_id,
        numero_nf: item.numero_nf,
      }))
    );
  }

  // Log event
  await supabase.from('eventos').insert({
    pedido_id: pedidoId,
    tipo: 'status_change',
    descricao: `Enriquecimento concluido — ${result.items.length} itens criados`,
    dados: {
      itens_count: result.items.length,
      nome_cliente: result.nomeCliente,
      forma_frete: result.formaFrete,
    },
    ator: 'sistema',
  });
}

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

  const parts = sku.split('-');
  const molde = parts[5]?.trim() || null;
  const fonte = parts[7]?.trim() || null;

  return { molde, fonte };
}

function parsePersonalization(
  infoAdicional: string | undefined,
  linhaProduto: string
): string | null {
  if (!infoAdicional) return null;

  if (linhaProduto === 'uniquebox') {
    return infoAdicional.trim() || null;
  }

  return infoAdicional.trim() || null;
}

export async function enrichOrder(
  pedidoId: string,
  tinyNfId: number,
  tinyPedidoId: number,
  linhaProduto: string
): Promise<EnrichmentResult> {
  // Fetch NF details (v3 returns flat object)
  const nfData = await fetchNF(tinyNfId);
  const numeroNf = nfData.numero ? Number(nfData.numero) : 0;

  // Fetch original order details (v3 returns flat object)
  const orderData = await fetchOrder(tinyPedidoId);

  const nomeCliente = orderData.cliente?.nome ?? null;
  const formaFrete = orderData.transportador?.formaFrete?.nome
    ?? orderData.transportador?.formaEnvio?.nome
    ?? null;
  const idFormaEnvio = orderData.transportador?.formaEnvio?.id ?? null;
  const idFormaFrete = orderData.transportador?.formaFrete?.id ?? null;
  const idTransportador = orderData.transportador?.id ?? null;

  // Process items
  const items: EnrichmentResult['items'] = [];

  for (const entry of orderData.itens ?? []) {
    const quantidade = entry.quantidade ?? 1;
    const sku = entry.produto?.sku;
    const descricao = entry.produto?.descricao ?? '';
    const infoAdicional = entry.informacoesAdicionais ?? '';

    // Skip Kit Surpresa
    if (entry.produto?.id === KIT_SURPRESA_PRODUCT_ID) continue;

    const { molde, fonte } = parseSKU(sku, linhaProduto);
    const personalizacao = parsePersonalization(infoAdicional, linhaProduto);
    const hasPerson = linhaProduto === 'uniquebox'
      ? !!personalizacao
      : molde !== 'PD' && fonte !== 'TD';

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

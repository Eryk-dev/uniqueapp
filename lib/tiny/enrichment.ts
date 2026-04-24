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
    sku: string | null;
  }>;
  nomeCliente: string | null;
  formaFrete: string | null;
  idFormaEnvio: number | null;
  idFormaFrete: number | null;
  idTransportador: number | null;
}

const SKU_SUFFIX_MAP: Array<{ suffix: string; molde: string; fonte: string }> = [
  { suffix: '-6-3', molde: 'TD', fonte: 'TD' },
  { suffix: '-1-2', molde: 'NM AV', fonte: 'FORMA' },
  { suffix: '-2-2', molde: 'NM AV CP', fonte: 'FORMA' },
  { suffix: '-4-2', molde: 'NNA', fonte: 'FORMA' },
  { suffix: '-5-2', molde: 'NNA CP', fonte: 'FORMA' },
];

function parseSKU(sku: string | undefined, linhaProduto: string): { molde: string | null; fonte: string | null } {
  if (!sku || linhaProduto !== 'uniquekids') return { molde: null, fonte: null };

  const skuTrimmed = sku.trim();
  const match = SKU_SUFFIX_MAP.find((entry) => skuTrimmed.endsWith(entry.suffix));
  if (!match) return { molde: null, fonte: null };

  return { molde: match.molde, fonte: match.fonte };
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
    const infoAdicional = entry.infoAdicional ?? '';

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
        sku: sku ?? null,
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
        sku: item.sku,
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

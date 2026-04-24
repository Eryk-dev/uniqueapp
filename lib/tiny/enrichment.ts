import { fetchNF, fetchOrder } from './client';
import { createServerClient } from '@/lib/supabase/server';
import { downloadPendingPhotosForItems } from '@/lib/storage/photos';

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

  // Se há itens de bloco, disparar pipeline de fotos
  const hasBloco = result.items.some((i) => i.modelo.toLowerCase().includes('bloco'));
  if (hasBloco) {
    const blocoResult = await enrichBlocoPhotos(pedidoId);
    if (!blocoResult.ok) {
      await supabase
        .from('pedidos')
        .update({ status: 'erro' })
        .eq('id', pedidoId);

      await supabase.from('eventos').insert({
        pedido_id: pedidoId,
        tipo: 'erro',
        descricao: `Falha ao buscar fotos de bloco: ${blocoResult.error.code}`,
        dados: blocoResult.error,
        ator: 'sistema',
      });
    } else {
      await supabase.from('eventos').insert({
        pedido_id: pedidoId,
        tipo: 'api_call',
        descricao: 'Fotos de bloco enfileiradas para download',
        ator: 'sistema',
      });
    }
  }
}

/**
 * Para pedidos com itens de bloco, parseia o campo `personalizacao` do Tiny
 * (que vem de Shopify line_item properties mas truncado em 255 chars pelo Tiny),
 * cria linhas em fotos_bloco e dispara download em background.
 *
 * Quando detecta URL truncada (a 3ª URL quando personalizacao atinge 255 chars),
 * insere uma linha com status='erro' pra operador resolver manualmente via SQL/UI.
 *
 * Retorna:
 * - {ok: true} se o parse e insert correram bem (mesmo com truncamento — gate bloqueia depois)
 * - {ok: false, error: ...} só em erros estruturais (DB down, pedido não existe)
 */
export async function enrichBlocoPhotos(
  pedidoId: string
): Promise<{ ok: true } | { ok: false; error: { code: string; message: string } }> {
  const supabase = createServerClient();

  // 1. Buscar itens de bloco do pedido
  const { data: blocoItems, error: itemsErr } = await supabase
    .from('itens_producao')
    .select('id, personalizacao, created_at')
    .eq('pedido_id', pedidoId)
    .ilike('modelo', '%bloco%')
    .order('created_at', { ascending: true });

  if (itemsErr) {
    return { ok: false, error: { code: 'supabase_query_failed', message: itemsErr.message } };
  }

  if (!blocoItems || blocoItems.length === 0) {
    return { ok: true }; // nada a fazer
  }

  // 2. Para cada item, parsear personalizacao e coletar rows
  // DEDUP: quando pedido vem com quantity > 1, o Tiny expande em N itens com
  // a MESMA personalizacao (duplicada). As fotos são as mesmas do pedido, então
  // a chapa deve ter uma entrada por URL única, não por unidade. Dedup por
  // (posicao, url) global no pedido — se uma combinação já foi vista num item
  // anterior, skippa nos seguintes.
  const rowsToInsert: Array<{
    item_id: string;
    posicao: number;
    shopify_url: string;
    status: 'pendente' | 'erro';
    erro_detalhe: string | null;
  }> = [];

  const seenPhotos = new Set<string>();
  const truncatedItems: string[] = [];
  const invalidLabelItems: Array<{ item_id: string; labels: string[] }> = [];

  for (const item of blocoItems) {
    const text = item.personalizacao ?? '';
    if (!text.trim()) continue;

    const parsed = parsePersonalizacao(text);

    for (const foto of parsed.fotos) {
      const key = `${foto.posicao}|${foto.url}`;
      if (seenPhotos.has(key)) continue;
      seenPhotos.add(key);

      rowsToInsert.push({
        item_id: item.id,
        posicao: foto.posicao,
        shopify_url: foto.url,
        status: 'pendente',
        erro_detalhe: null,
      });
    }

    for (const truncated of parsed.truncated) {
      const key = `${truncated.posicao}|TRUNCATED|${truncated.prefix}`;
      if (seenPhotos.has(key)) continue;
      seenPhotos.add(key);

      rowsToInsert.push({
        item_id: item.id,
        posicao: truncated.posicao,
        shopify_url: truncated.prefix || '[truncada]',
        status: 'erro',
        erro_detalhe: 'tiny_personalizacao_truncada',
      });
      truncatedItems.push(item.id);
    }

    if (parsed.invalid_labels.length > 0) {
      invalidLabelItems.push({ item_id: item.id, labels: parsed.invalid_labels });
    }
  }

  if (rowsToInsert.length === 0) {
    return { ok: false, error: { code: 'no_fotos_parsed', message: 'Nenhuma foto extraída do campo personalizacao dos itens de bloco' } };
  }

  // 3. Insere rows em fotos_bloco (idempotente via UNIQUE constraint)
  const { error: insertErr } = await supabase
    .from('fotos_bloco')
    .upsert(rowsToInsert, { onConflict: 'item_id,posicao' });

  if (insertErr) {
    return { ok: false, error: { code: 'fotos_bloco_insert_failed', message: insertErr.message } };
  }

  // 4. Log eventos de anomalias (não-fatais)
  if (truncatedItems.length > 0) {
    await supabase.from('eventos').insert({
      pedido_id: pedidoId,
      tipo: 'warning',
      descricao: `Personalizacao truncada em ${truncatedItems.length} item(ns) — 3ª foto indisponível`,
      dados: { item_ids: truncatedItems },
      ator: 'sistema',
    });
  }

  if (invalidLabelItems.length > 0) {
    await supabase.from('eventos').insert({
      pedido_id: pedidoId,
      tipo: 'warning',
      descricao: `Labels Foto inválidos detectados (ex: "Foto null:")`,
      dados: { items: invalidLabelItems },
      ator: 'sistema',
    });
  }

  // 5. Dispara download em background (fire-and-forget)
  const itemIds = Array.from(new Set(rowsToInsert.map((r) => r.item_id)));
  downloadPendingPhotosForItems(itemIds).catch((err) => {
    console.error('[enrichBlocoPhotos] background download failed:', err);
  });

  return { ok: true };
}

/**
 * Parseia o campo personalizacao do Tiny.
 *
 * Formato esperado:
 *   "Foto 1: https://...jpg,Foto 2: https://...jpg,Foto 3: https://...jpg"
 *
 * Edge cases observados no histórico:
 * - Truncamento em 255 chars: "Foto 3: https://cdn.shopify.com/s/files/1/0629/6200" (URL sem .jpg)
 * - Label inválido: "Foto null:" (bug upstream do Shopify app de customização)
 * - String vazia ou só whitespace
 *
 * @returns fotos = URLs completas (terminam em extensão de imagem válida)
 *          truncated = posições onde URL começou mas não terminou (com prefix pra debug)
 *          invalid_labels = labels que não bateram com "Foto <numero>:"
 */
export function parsePersonalizacao(text: string): {
  fotos: Array<{ posicao: number; url: string }>;
  truncated: Array<{ posicao: number; prefix: string }>;
  invalid_labels: string[];
} {
  const fotos: Array<{ posicao: number; url: string }> = [];
  const truncated: Array<{ posicao: number; prefix: string }> = [];
  const invalid_labels: string[] = [];

  // Regex explicado:
  // Foto\s*([^\s:]+?)  → captura o label (qualquer coisa sem espaço/dois-pontos)
  // \s*:\s*            → separador ": "
  // ([^,]*?)           → captura o valor até a vírgula (non-greedy)
  // (?=(?:,\s*Foto\s*[^\s:]+?\s*:)|$)  → lookahead: próximo "Foto X:" ou fim da string
  const pattern = /Foto\s*([^\s:]+?)\s*:\s*([^,]*?)(?=(?:,\s*Foto\s*[^\s:]+?\s*:)|$)/gi;

  const imageUrlExt = /\.(jpg|jpeg|png|webp|gif)(?:\?.*)?$/i;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const label = match[1]!.trim();
    const value = (match[2] ?? '').trim();

    // Label inválido (ex: "null", "abc"). Ignora com log.
    if (!/^\d+$/.test(label)) {
      invalid_labels.push(label);
      continue;
    }

    const posicao = parseInt(label, 10);
    if (!Number.isFinite(posicao) || posicao < 1) {
      invalid_labels.push(label);
      continue;
    }

    // Valor vazio ou sem protocolo: ignora
    if (!value || !/^https?:\/\//i.test(value)) {
      continue;
    }

    // URL completa (termina em extensão conhecida): ok
    if (imageUrlExt.test(value)) {
      fotos.push({ posicao, url: value });
    } else {
      // URL começou mas foi cortada: truncada
      truncated.push({ posicao, prefix: value });
    }
  }

  return { fotos, truncated, invalid_labels };
}

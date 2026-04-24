import { fetchNF, fetchOrder } from './client';
import { createServerClient } from '@/lib/supabase/server';
import { fetchPhotosFromOrder } from '@/lib/shopify/orders';
import { downloadPendingPhotosForItems } from '@/lib/storage/photos';
import { ShopifyApiError } from '@/lib/shopify/types';

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
 * Para pedidos com itens de bloco, busca URLs de foto no Shopify,
 * cria linhas em fotos_bloco (status=pendente) e dispara download em background.
 *
 * Retorna:
 * - {ok: true} se tudo correu bem
 * - {ok: false, error: {code, message}} se Shopify retornou erro permanente — chamador marca pedido como erro
 *
 * Erros de download individuais (por foto) não geram ok:false; a foto fica com status='erro'
 * mas o pedido segue no fluxo normal, e o gate de geração bloqueia depois.
 */
export async function enrichBlocoPhotos(
  pedidoId: string
): Promise<{ ok: true } | { ok: false; error: { code: string; message: string } }> {
  const supabase = createServerClient();

  // 1. Buscar pedido e itens de bloco
  const { data: pedido, error: pedidoErr } = await supabase
    .from('pedidos')
    .select('id, id_pedido_ecommerce')
    .eq('id', pedidoId)
    .single();

  if (pedidoErr || !pedido) {
    return { ok: false, error: { code: 'pedido_not_found', message: pedidoErr?.message ?? 'Not found' } };
  }

  if (!pedido.id_pedido_ecommerce) {
    return { ok: false, error: { code: 'shopify_no_order_id', message: 'Pedido sem id_pedido_ecommerce' } };
  }

  const { data: blocoItems, error: itemsErr } = await supabase
    .from('itens_producao')
    .select('id, sku, created_at')
    .eq('pedido_id', pedidoId)
    .ilike('modelo', '%bloco%')
    .order('created_at', { ascending: true });

  if (itemsErr) {
    return { ok: false, error: { code: 'supabase_query_failed', message: itemsErr.message } };
  }

  if (!blocoItems || blocoItems.length === 0) {
    return { ok: true }; // nada a fazer
  }

  // 2. Chamar Shopify
  let photos;
  try {
    photos = await fetchPhotosFromOrder(pedido.id_pedido_ecommerce);
  } catch (err) {
    if (err instanceof ShopifyApiError) {
      return { ok: false, error: { code: `shopify_${err.code}`, message: err.message } };
    }
    return { ok: false, error: { code: 'shopify_unknown', message: (err as Error).message } };
  }

  if (photos.length === 0) {
    return { ok: false, error: { code: 'shopify_no_photos', message: 'Pedido Shopify sem customAttributes "Foto N:"' } };
  }

  // 3. Match Shopify line_items ↔ Supabase items por SKU
  // Agrupa fotos por SKU + lineItemIndex (pra casos de quantity > 1)
  const photosBySku = new Map<string, typeof photos>();
  for (const p of photos) {
    const key = p.sku ?? '__null__';
    if (!photosBySku.has(key)) photosBySku.set(key, []);
    photosBySku.get(key)!.push(p);
  }

  const itemsBySku = new Map<string, typeof blocoItems>();
  for (const i of blocoItems) {
    const key = i.sku ?? '__null__';
    if (!itemsBySku.has(key)) itemsBySku.set(key, []);
    itemsBySku.get(key)!.push(i);
  }

  // Valida que todo item tem match
  const rowsToInsert: Array<{ item_id: string; posicao: number; shopify_url: string; status: string }> = [];
  for (const [sku, items] of Array.from(itemsBySku.entries())) {
    const matchedPhotos = photosBySku.get(sku) ?? [];
    if (matchedPhotos.length === 0) {
      return {
        ok: false,
        error: {
          code: 'shopify_item_mismatch',
          message: `Items Supabase com sku=${sku} não têm fotos correspondentes no Shopify`,
        },
      };
    }

    // Agrupa fotos por lineItemIndex pra atribuir cada line_item a um item_id
    const photosByLineItem = new Map<number, typeof photos>();
    for (const p of matchedPhotos) {
      if (!photosByLineItem.has(p.lineItemIndex)) photosByLineItem.set(p.lineItemIndex, []);
      photosByLineItem.get(p.lineItemIndex)!.push(p);
    }

    const lineItemIndices = Array.from(photosByLineItem.keys()).sort((a, b) => a - b);

    if (lineItemIndices.length > items.length) {
      return {
        ok: false,
        error: {
          code: 'shopify_item_mismatch',
          message: `Shopify tem ${lineItemIndices.length} line_items com sku=${sku}, Supabase tem ${items.length} items`,
        },
      };
    }

    // Atribui cada line_item (em ordem) ao próximo item do Supabase
    lineItemIndices.forEach((lineIdx, posInItems) => {
      const item = items[posInItems];
      if (!item) return;
      const linePhotos = photosByLineItem.get(lineIdx)!;
      for (const p of linePhotos) {
        rowsToInsert.push({
          item_id: item.id,
          posicao: p.posicao,
          shopify_url: p.url,
          status: 'pendente',
        });
      }
    });

    // Se Supabase tem MAIS items que Shopify tem line_items do SKU:
    // assume que o Supabase expandiu por quantity e cada item recebe as mesmas fotos
    if (items.length > lineItemIndices.length && lineItemIndices.length > 0) {
      const lastLineIdx = lineItemIndices[lineItemIndices.length - 1]!;
      const lastPhotos = photosByLineItem.get(lastLineIdx)!;
      for (let i = lineItemIndices.length; i < items.length; i++) {
        for (const p of lastPhotos) {
          rowsToInsert.push({
            item_id: items[i]!.id,
            posicao: p.posicao,
            shopify_url: p.url,
            status: 'pendente',
          });
        }
      }
    }
  }

  // 4. Insere rows em fotos_bloco (idempotente via UNIQUE constraint)
  const { error: insertErr } = await supabase
    .from('fotos_bloco')
    .upsert(rowsToInsert, { onConflict: 'item_id,posicao' });

  if (insertErr) {
    return { ok: false, error: { code: 'fotos_bloco_insert_failed', message: insertErr.message } };
  }

  // 5. Dispara download em background (fire-and-forget igual cacheExpeditionLabels)
  const itemIds = Array.from(new Set(rowsToInsert.map((r) => r.item_id)));
  downloadPendingPhotosForItems(itemIds).catch((err) => {
    console.error('[enrichBlocoPhotos] background download failed:', err);
  });

  return { ok: true };
}

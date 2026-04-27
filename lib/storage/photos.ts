// lib/storage/photos.ts
import { createServerClient, createStorageClient } from '@/lib/supabase/server';

const BUCKET = 'bloco-fotos';
const MAX_DOWNLOAD_RETRIES = 2;
const DOWNLOAD_TIMEOUT_MS = 30_000;

export interface DownloadResult {
  storage_path: string;
  largura_px?: number;
  altura_px?: number;
  tamanho_bytes: number;
  content_type: string;
  public_url: string;
}

function extFromContentType(ct: string): string {
  const mapping: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  return mapping[ct.toLowerCase()] ?? 'bin';
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_DOWNLOAD_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(url, DOWNLOAD_TIMEOUT_MS);
      if (res.ok) return res;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new Error(`Download failed: ${res.status} ${res.statusText}`);
      }
      lastError = new Error(`Download ${res.status} ${res.statusText}`);
    } catch (err) {
      lastError = err as Error;
    }
    if (attempt < MAX_DOWNLOAD_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastError ?? new Error('Download failed');
}

/**
 * Baixa uma foto do Shopify CDN e re-hospeda no bucket bloco-fotos.
 * Retorna metadata do arquivo no Storage.
 *
 * Path no bucket: <pedido_id>/<item_id>/<posicao>.<ext>
 *
 * Lança erro se o download ou upload falhar após retries.
 */
export async function downloadAndStore(params: {
  pedido_id: string;
  item_id: string;
  posicao: number;
  shopify_url: string;
}): Promise<DownloadResult> {
  const { pedido_id, item_id, posicao, shopify_url } = params;

  const res = await fetchWithRetry(shopify_url);
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const arrayBuffer = await res.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);

  const ext = extFromContentType(contentType);
  const storage_path = `${pedido_id}/${item_id}/${posicao}.${ext}`;

  const storage = createStorageClient();
  const { error: uploadError } = await storage.storage
    .from(BUCKET)
    .upload(storage_path, bytes, {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const { data: pub } = storage.storage.from(BUCKET).getPublicUrl(storage_path);

  return {
    storage_path,
    tamanho_bytes: bytes.length,
    content_type: contentType,
    public_url: pub.publicUrl,
  };
}

/**
 * Processa todas as fotos de um conjunto de item_ids.
 * Lê fotos_bloco WHERE status='pendente' AND item_id IN (...), baixa, atualiza cada linha.
 * Retorna {ok, erro} counts.
 */
export async function downloadPendingPhotosForItems(
  itemIds: string[]
): Promise<{ ok: number; erro: number }> {
  if (itemIds.length === 0) return { ok: 0, erro: 0 };

  const supabase = createServerClient();
  const { data: fotos, error } = await supabase
    .from('fotos_bloco')
    .select('id, item_id, posicao, shopify_url, itens_producao!inner(pedido_id)')
    .eq('status', 'pendente')
    .in('item_id', itemIds);

  if (error) throw new Error(`Query fotos_bloco failed: ${error.message}`);

  let ok = 0;
  let erro = 0;

  for (const foto of fotos ?? []) {
    // Supabase typing: inner-joined relation may come as array or single object
    const relation = Array.isArray(foto.itens_producao) ? foto.itens_producao[0] : foto.itens_producao;
    const pedido_id = (relation as unknown as { pedido_id: string } | undefined)?.pedido_id;
    if (!pedido_id) {
      erro++;
      continue;
    }

    try {
      const result = await downloadAndStore({
        pedido_id,
        item_id: foto.item_id,
        posicao: foto.posicao,
        shopify_url: foto.shopify_url,
      });

      await supabase
        .from('fotos_bloco')
        .update({
          storage_path: result.storage_path,
          tamanho_bytes: result.tamanho_bytes,
          content_type: result.content_type,
          status: 'baixada',
          baixada_em: new Date().toISOString(),
          erro_detalhe: null,
        })
        .eq('id', foto.id);

      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabase
        .from('fotos_bloco')
        .update({ status: 'erro', erro_detalhe: msg })
        .eq('id', foto.id);
      erro++;
    }
  }

  // Atualiza flag tem_fotos_bloco
  for (const itemId of itemIds) {
    const { count } = await supabase
      .from('fotos_bloco')
      .select('id', { count: 'exact', head: true })
      .eq('item_id', itemId)
      .eq('status', 'baixada');

    await supabase
      .from('itens_producao')
      .update({ tem_fotos_bloco: (count ?? 0) > 0 })
      .eq('id', itemId);
  }

  return { ok, erro };
}

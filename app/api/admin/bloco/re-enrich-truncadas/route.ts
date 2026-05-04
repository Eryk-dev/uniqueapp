import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { enrichBlocoPhotos } from '@/lib/tiny/enrichment';

/**
 * One-shot pra desbloquear pedidos cuja 3ª foto ficou marcada como erro
 * `tiny_personalizacao_truncada` antes do fix do fallback Shopify
 * (commit 153806a). Re-roda enrichBlocoPhotos com a logica nova, que
 * busca a URL completa via Shopify GraphQL Admin API.
 *
 * Idempotente — pode rodar quantas vezes quiser. Se já tiver baixado, só
 * confirma e segue. Se Shopify nao tiver a foto (raro), volta pro estado
 * anterior (status=erro com mesmo erro_detalhe).
 */
export async function POST() {
  const supabase = createServerClient();

  const { data: stuckRows, error: queryErr } = await supabase
    .from('fotos_bloco')
    .select('item_id, itens_producao!inner(pedido_id)')
    .eq('status', 'erro')
    .eq('erro_detalhe', 'tiny_personalizacao_truncada');

  if (queryErr) {
    return NextResponse.json({ error: queryErr.message }, { status: 500 });
  }

  const pedidoIds = new Set<string>();
  for (const row of stuckRows ?? []) {
    const relation = Array.isArray(row.itens_producao) ? row.itens_producao[0] : row.itens_producao;
    const pid = (relation as unknown as { pedido_id?: string } | undefined)?.pedido_id;
    if (pid) pedidoIds.add(pid);
  }

  if (pedidoIds.size === 0) {
    return NextResponse.json({ ok: true, message: 'Nenhum pedido travado por truncamento', results: [] });
  }

  const results: Array<{ pedido_id: string; ok: boolean; error?: string }> = [];

  for (const pid of Array.from(pedidoIds)) {
    try {
      const r = await enrichBlocoPhotos(pid);
      if (r.ok) {
        results.push({ pedido_id: pid, ok: true });
      } else {
        results.push({ pedido_id: pid, ok: false, error: `${r.error.code}: ${r.error.message}` });
      }
    } catch (err) {
      results.push({ pedido_id: pid, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return NextResponse.json({
    ok: true,
    total: results.length,
    sucesso: okCount,
    falhas: results.length - okCount,
    results,
  });
}

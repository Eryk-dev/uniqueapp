// scripts/backfill-bloco-photos.ts
/**
 * Backfill de fotos de bloco para pedidos em aberto (status pronto_producao ou em_producao).
 *
 * Parseia o campo `personalizacao` já presente em itens_producao e cria linhas
 * em fotos_bloco + dispara download.
 *
 * Rodar:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   npm run backfill:bloco-photos
 */
import { createClient } from '@supabase/supabase-js';
import { enrichBlocoPhotos } from '../lib/tiny/enrichment';
import { downloadPendingPhotosForItems } from '../lib/storage/photos';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: 'unique_app' } }
  );

  const { data: pedidos, error } = await supabase
    .from('pedidos')
    .select('id, numero, itens_producao!inner(id, modelo)')
    .in('status', ['pronto_producao', 'em_producao'])
    .ilike('itens_producao.modelo', '%bloco%');

  if (error) throw new Error(error.message);
  if (!pedidos || pedidos.length === 0) {
    console.log('Nenhum pedido em aberto com item de bloco. Nada a fazer.');
    return;
  }

  // Dedup (o !inner pode trazer um pedido por item — queremos único por pedido)
  const uniquePedidos = Array.from(
    new Map(pedidos.map((p) => [p.id, p])).values()
  );

  console.log(`Encontrados ${uniquePedidos.length} pedido(s) em aberto para backfill.\n`);

  let okCount = 0;
  let errCount = 0;
  let truncatedCount = 0;

  for (const pedido of uniquePedidos) {
    console.log(`--- Pedido ${pedido.numero} (id=${pedido.id}) ---`);

    const result = await enrichBlocoPhotos(pedido.id);
    if (result.ok) {
      // Checa se algum foto ficou como erro (truncated)
      const { count } = await supabase
        .from('fotos_bloco')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'erro')
        .eq('erro_detalhe', 'tiny_personalizacao_truncada')
        .in('item_id',
          (pedido.itens_producao as Array<{ id: string }>).map((i) => i.id)
        );
      if ((count ?? 0) > 0) {
        console.log(`  ⚠️  Enfileirado mas ${count} foto(s) truncada(s) — operador precisa resolver`);
        truncatedCount++;
      } else {
        console.log('  ✓ Enfileirado');
      }
      okCount++;
    } else {
      console.error(`  ✗ ${result.error.code}: ${result.error.message}`);
      errCount++;
    }

    // Pequeno delay pra não sobrecarregar downloads
    await new Promise((r) => setTimeout(r, 200));
  }

  // Flush final: aguarda downloads de fotos que possam ter ficado 'pendente'
  // (o fire-and-forget interno de enrichBlocoPhotos pode ser interrompido quando
  // o script termina; chamar downloadPendingPhotosForItems aguardado aqui
  // garante que tudo seja baixado antes do exit).
  const allItemIds = uniquePedidos.flatMap((p) =>
    (p.itens_producao as Array<{ id: string }>).map((i) => i.id)
  );
  if (allItemIds.length > 0) {
    console.log(`\nAguardando downloads pendentes de ${allItemIds.length} item(ns)...`);
    const flush = await downloadPendingPhotosForItems(allItemIds);
    console.log(`Flush: ${flush.ok} baixadas, ${flush.erro} erro`);
  }

  console.log(`\nResultado: ${okCount} ok, ${errCount} erro (${truncatedCount} com fotos truncadas) (total ${uniquePedidos.length})`);
  process.exit(errCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

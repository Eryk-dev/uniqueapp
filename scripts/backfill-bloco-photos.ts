// scripts/backfill-bloco-photos.ts
/**
 * Backfill de fotos de bloco para pedidos em aberto (status pronto_producao ou em_producao).
 *
 * 1. Popula sku em itens_producao que não têm (usa Tiny API para buscar pedido)
 * 2. Para cada pedido com bloco, chama enrichBlocoPhotos (mesma função do webhook)
 *
 * Rodar:
 *   SHOPIFY_ADMIN_TOKEN=... SHOPIFY_SHOP_DOMAIN=uniqueboxbrasil.myshopify.com \
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   TINY_ACCESS_TOKEN=... \
 *   npm run backfill:bloco-photos
 */
import { createClient } from '@supabase/supabase-js';
import { enrichBlocoPhotos } from '../lib/tiny/enrichment';
import { fetchOrder } from '../lib/tiny/client';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: 'unique_app' } }
  );

  // 1. Pedidos em aberto com item de bloco
  const { data: pedidos, error } = await supabase
    .from('pedidos')
    .select('id, tiny_pedido_id, numero, itens_producao!inner(id, modelo, sku)')
    .in('status', ['pronto_producao', 'em_producao'])
    .ilike('itens_producao.modelo', '%bloco%');

  if (error) throw new Error(error.message);
  if (!pedidos || pedidos.length === 0) {
    console.log('Nenhum pedido em aberto com item de bloco. Nada a fazer.');
    return;
  }

  console.log(`Encontrados ${pedidos.length} pedido(s) em aberto para backfill.\n`);

  let okCount = 0;
  let errCount = 0;

  for (const pedido of pedidos) {
    console.log(`--- Pedido ${pedido.numero} (id=${pedido.id}) ---`);

    // 1a. Popular SKU se faltando
    const itensSemSku = (pedido.itens_producao as Array<{ id: string; modelo: string; sku: string | null }>)
      .filter((i) => !i.sku);

    if (itensSemSku.length > 0) {
      console.log(`  Populando sku em ${itensSemSku.length} item(ns)...`);
      try {
        const order = await fetchOrder(pedido.tiny_pedido_id);
        const tinyItems = order.itens ?? [];

        // Para cada item sem SKU no Supabase, tenta achar no Tiny pelo modelo (descricao)
        for (const item of itensSemSku) {
          const match = tinyItems.find((ti) => ti.produto?.descricao === item.modelo);
          if (match?.produto?.sku) {
            await supabase
              .from('itens_producao')
              .update({ sku: match.produto.sku })
              .eq('id', item.id);
          }
        }
      } catch (err) {
        console.error(`  ✗ Falha ao buscar Tiny: ${(err as Error).message}`);
        errCount++;
        continue;
      }
    }

    // 1b. Chamar enrichBlocoPhotos
    const result = await enrichBlocoPhotos(pedido.id);
    if (result.ok) {
      console.log('  ✓ Enfileirado');
      okCount++;
    } else {
      console.error(`  ✗ ${result.error.code}: ${result.error.message}`);
      errCount++;
    }

    // Rate limit mínimo pra não estourar Shopify
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nResultado: ${okCount} ok, ${errCount} erro (total ${pedidos.length})`);
  process.exit(errCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

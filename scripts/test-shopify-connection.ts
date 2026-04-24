// scripts/test-shopify-connection.ts
/**
 * Diagnóstico pré-deploy: valida SHOPIFY_ADMIN_TOKEN e formato dos customAttributes.
 * Pega 3 pedidos de bloco do Supabase, chama Shopify, imprime o que achou.
 *
 * Rodar:
 *   SHOPIFY_ADMIN_TOKEN=shpat_... SHOPIFY_SHOP_DOMAIN=uniqueboxbrasil.myshopify.com \
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   npm run test:shopify
 */
import { createClient } from '@supabase/supabase-js';
import { fetchPhotosFromOrder } from '../lib/shopify/orders';
import { ShopifyApiError } from '../lib/shopify/types';

async function main() {
  // 1. Env vars
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('[ERR] SUPABASE env vars ausentes');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
    db: { schema: 'unique_app' },
  });

  // 2. Pega 3 pedidos de bloco distintos
  const { data: items, error } = await supabase
    .from('itens_producao')
    .select('pedido_id, modelo, personalizacao, pedidos!inner(id_pedido_ecommerce, numero, nome_ecommerce)')
    .ilike('modelo', '%bloco%')
    .not('personalizacao', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('[ERR] Query Supabase:', error.message);
    process.exit(1);
  }

  // Deduplica por pedido
  const seen = new Set<string>();
  const samples = (items ?? [])
    .filter((i) => {
      const pedidosArray = Array.isArray(i.pedidos) ? i.pedidos : [i.pedidos];
      const pedido = pedidosArray[0] as unknown as { id_pedido_ecommerce?: string };
      const pid = pedido?.id_pedido_ecommerce;
      if (!pid || seen.has(pid)) return false;
      seen.add(pid);
      return true;
    })
    .slice(0, 3);

  if (samples.length === 0) {
    console.error('[ERR] Nenhum pedido de bloco histórico encontrado no Supabase');
    process.exit(1);
  }

  console.log(`Testando ${samples.length} pedido(s):\n`);

  let passCount = 0;
  for (const item of samples) {
    const pedidosArray = Array.isArray(item.pedidos) ? item.pedidos : [item.pedidos];
    const pedido = pedidosArray[0] as unknown as { id_pedido_ecommerce: string; numero: number };
    const shopifyId = pedido.id_pedido_ecommerce;
    const tinyNumero = pedido.numero;

    console.log(`--- Pedido Tiny #${tinyNumero} (Shopify ${shopifyId}) ---`);
    try {
      const photos = await fetchPhotosFromOrder(shopifyId);
      if (photos.length === 0) {
        console.log('  ⚠️  Nenhuma foto encontrada nos customAttributes');
        console.log(`  Personalizacao (Tiny, truncada): ${item.personalizacao?.slice(0, 80)}...`);
      } else {
        console.log(`  ✓ ${photos.length} foto(s) extraída(s):`);
        for (const p of photos) {
          console.log(`    - line_item[${p.lineItemIndex}] sku=${p.sku} posicao=${p.posicao}`);
          console.log(`      url=${p.url}`);
        }
        passCount++;
      }
    } catch (err) {
      if (err instanceof ShopifyApiError) {
        console.error(`  ✗ ${err.code}: ${err.message}`);
      } else {
        console.error(`  ✗ unexpected: ${(err as Error).message}`);
      }
    }
    console.log();
  }

  console.log(`Resultado: ${passCount}/${samples.length} pedidos com fotos OK`);
  process.exit(passCount === samples.length ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

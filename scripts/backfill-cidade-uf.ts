// scripts/backfill-cidade-uf.ts
//
// Preenche pedidos.cidade / pedidos.uf nos pedidos importados ANTES dessas
// colunas existirem (migration 014). Sem isso, o romaneio de transportadora
// sai com a coluna "Cidade / UF" vazia nos pedidos antigos.
//
// Pedidos novos ja chegam preenchidos — ingest (lib/tiny/ingest.ts) e
// enrichment (lib/tiny/enrichment.ts) extraem do mesmo fetchOrder que ja
// faziam, custo zero de API.
//
// Uso:
//   NEXT_PUBLIC_SUPABASE_URL=https://tkfpbcyjmaifuvfjqobn.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY='...' \
//   npx tsx scripts/backfill-cidade-uf.ts [dias]
//
// `dias` (default 90) limita a janela de pedidos considerados.
//
// O rate limiter do Tiny serializa em ~1.1s por pedido, entao 300 pedidos
// levam ~6 min. Pode rodar quantas vezes quiser: so' pega quem esta sem
// cidade, e pedido que o Tiny nao devolve endereco fica de fora (segue null).

import { createServerClient } from '../lib/supabase/server';
import { fetchOrder } from '../lib/tiny/client';
import { extractCidadeUf } from '../lib/tiny/endereco';

async function main() {
  const dias = Number(process.argv[2] ?? 90);
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

  const supabase = createServerClient();

  const { data: pedidos, error } = await supabase
    .from('pedidos')
    .select('id, numero, tiny_pedido_id')
    .is('cidade', null)
    .gte('created_at', desde)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  if (!pedidos?.length) {
    console.log(`Nada a fazer — nenhum pedido sem cidade nos ultimos ${dias} dias.`);
    return;
  }

  console.log(`${pedidos.length} pedido(s) sem cidade/UF nos ultimos ${dias} dias.\n`);

  let ok = 0;
  let semEndereco = 0;
  let falhas = 0;

  for (let i = 0; i < pedidos.length; i++) {
    const pedido = pedidos[i];
    const prefixo = `[${i + 1}/${pedidos.length}] #${pedido.numero}`;
    try {
      const order = await fetchOrder(pedido.tiny_pedido_id);
      const { cidade, uf } = extractCidadeUf(order);

      if (!cidade && !uf) {
        semEndereco++;
        console.log(`${prefixo} — sem endereco no Tiny, pulado`);
        continue;
      }

      const { error: updErr } = await supabase
        .from('pedidos')
        .update({ cidade, uf })
        .eq('id', pedido.id);

      if (updErr) throw new Error(updErr.message);

      ok++;
      console.log(`${prefixo} — ${cidade ?? '?'} / ${uf ?? '?'}`);
    } catch (err) {
      falhas++;
      console.error(`${prefixo} — FALHOU:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nPreenchidos: ${ok} · sem endereco: ${semEndereco} · falhas: ${falhas}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

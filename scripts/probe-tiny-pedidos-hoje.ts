// scripts/probe-tiny-pedidos-hoje.ts  (READ-ONLY — só lista, não cria nada)
// Lista pedidos no Tiny a partir de uma data e cruza com o que já existe no app,
// pra ver quais ficaram de fora (webhook parado em 06:36 de 2026-06-09).
//
// Uso:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   npx tsx scripts/probe-tiny-pedidos-hoje.ts 2026-06-09

import { getValidToken } from '../lib/tiny/oauth';
import { createServerClient } from '../lib/supabase/server';

const TINY_BASE = 'https://api.tiny.com.br/public-api/v3';
const dataInicial = process.argv[2] ?? '2026-06-09';

async function listPage(token: string, offset: number) {
  const url = `${TINY_BASE}/pedidos?dataInicialOcorrencia=${dataInicial}&dataFinalOcorrencia=${dataInicial}&limit=50&offset=${offset}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`GET /pedidos ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json() as Promise<{ itens?: Array<Record<string, unknown>>; paginacao?: Record<string, unknown> }>;
}

async function main() {
  const token = await getValidToken();
  const supabase = createServerClient();

  // junta todas as paginas
  const tinyOrders: Array<Record<string, unknown>> = [];
  let offset = 0;
  for (let i = 0; i < 30; i++) {
    const page = await listPage(token, offset);
    const itens = page.itens ?? [];
    tinyOrders.push(...itens);
    console.log(`pagina offset=${offset}: ${itens.length} pedidos (total acumulado ${tinyOrders.length})`);
    if (itens.length < 100) break;
    offset += 100;
  }

  if (tinyOrders.length === 0) {
    console.log('Tiny nao retornou pedidos — confira o nome do parametro de data. Exemplo de 1 item bruto:');
    return;
  }

  // mostra shape do primeiro
  console.log('\nexemplo de pedido (campos):', Object.keys(tinyOrders[0]).join(', '));
  const num = (o: Record<string, unknown>) => Number(o.numeroPedido ?? o.numero ?? 0);
  const numeros = tinyOrders.map(num).filter(Boolean).sort((a, b) => a - b);
  console.log(`\nTiny: ${tinyOrders.length} pedidos desde ${dataInicial}. Faixa numero: ${numeros[0]}..${numeros[numeros.length - 1]}`);

  // cruza com o app
  const { data: noApp } = await supabase
    .from('pedidos')
    .select('numero')
    .gte('numero', numeros[0]);
  const noAppSet = new Set((noApp ?? []).map((p) => Number(p.numero)));
  const faltando = numeros.filter((n) => !noAppSet.has(n));
  console.log(`\nJa no app: ${noAppSet.size}. FALTANDO (no Tiny, fora do app): ${faltando.length}`);
  console.log('numeros faltando:', faltando.join(', '));
}

main().then(() => process.exit(0)).catch((e) => { console.error('FALHOU:', e); process.exit(1); });

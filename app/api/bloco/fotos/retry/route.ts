// app/api/bloco/fotos/retry/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { createServerClient } from '@/lib/supabase/server';
import { downloadAndStore } from '@/lib/storage/photos';

const schema = z.object({
  foto_ids: z.array(z.string().uuid()).min(1).max(100),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'foto_ids invalido' }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: fotos, error: queryErr } = await supabase
    .from('fotos_bloco')
    .select('id, item_id, posicao, shopify_url, itens_producao!inner(pedido_id)')
    .in('id', parsed.data.foto_ids);

  if (queryErr) {
    return NextResponse.json({ error: queryErr.message }, { status: 500 });
  }

  const results: Array<{ foto_id: string; status: 'baixada' | 'erro'; error?: string }> = [];

  for (const foto of fotos ?? []) {
    try {
      const relation = Array.isArray(foto.itens_producao)
        ? foto.itens_producao[0]
        : foto.itens_producao;
      const pedido_id = (relation as unknown as { pedido_id: string } | undefined)?.pedido_id;
      if (!pedido_id) {
        throw new Error('pedido_id not found');
      }

      const r = await downloadAndStore({
        pedido_id,
        item_id: foto.item_id,
        posicao: foto.posicao,
        shopify_url: foto.shopify_url,
      });
      await supabase
        .from('fotos_bloco')
        .update({
          storage_path: r.storage_path,
          tamanho_bytes: r.tamanho_bytes,
          content_type: r.content_type,
          status: 'baixada',
          baixada_em: new Date().toISOString(),
          erro_detalhe: null,
        })
        .eq('id', foto.id);
      results.push({ foto_id: foto.id, status: 'baixada' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabase
        .from('fotos_bloco')
        .update({ status: 'erro', erro_detalhe: msg })
        .eq('id', foto.id);
      results.push({ foto_id: foto.id, status: 'erro', error: msg });
    }
  }

  await supabase.from('eventos').insert({
    tipo: 'api_call',
    descricao: `Retry de ${results.length} foto(s); sucesso=${results.filter((r) => r.status === 'baixada').length}`,
    dados: { results },
    ator: authResult.id,
  });

  return NextResponse.json({ results });
}

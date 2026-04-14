import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const dados = payload.dados;

    if (!dados?.id) {
      return NextResponse.json({ error: 'Missing dados.id' }, { status: 400 });
    }

    const tinyNfId = dados.id;
    const supabase = createServerClient();

    // Find NF record
    const { data: nf } = await supabase
      .from('notas_fiscais')
      .select('*, pedidos(*)')
      .eq('tiny_nf_id', tinyNfId)
      .single();

    if (!nf) {
      // NF not in our system — ignore
      return NextResponse.json({ ok: true, ignored: true });
    }

    // Idempotency: skip if already authorized
    if (nf.autorizada) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    // Update NF as authorized
    await supabase
      .from('notas_fiscais')
      .update({
        autorizada: true,
        autorizada_at: new Date().toISOString(),
        numero_nf: dados.numero ?? nf.numero_nf,
      })
      .eq('id', nf.id);

    // Log event (enrichment will set status to pronto_producao)
    await supabase.from('eventos').insert({
      pedido_id: nf.pedido_id,
      tipo: 'status_change',
      descricao: `NF ${dados.numero ?? tinyNfId} autorizada pela SEFAZ`,
      dados: { tiny_nf_id: tinyNfId, numero_nf: dados.numero },
      ator: 'sistema',
    });

    // Trigger enrichment
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? request.nextUrl.origin
      : `http://localhost:${process.env.PORT ?? 3000}`;

    try {
      await fetch(`${baseUrl}/api/jobs/enrichment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedido_id: nf.pedido_id }),
      });
    } catch (err) {
      console.error('Failed to trigger enrichment:', err);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('NF autorizada webhook error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

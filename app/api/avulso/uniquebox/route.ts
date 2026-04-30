import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { createServerClient, createStorageClient } from '@/lib/supabase/server';
import { createProductionBatch } from '@/lib/production/batch';
import { downloadAndStore } from '@/lib/storage/photos';

const mensagemSchema = z.object({
  cliente: z.string().min(1),
  linha1: z.string().optional().default(''),
  linha2: z.string().optional().default(''),
  linha3: z.string().optional().default(''),
});

const blocoSchema = z
  .object({
    cliente: z.string().min(1),
    foto_url: z.string().url().optional(),
    foto_storage_path: z.string().optional(),
  })
  .refine((b) => !!(b.foto_url || b.foto_storage_path), {
    message: 'foto_url ou foto_storage_path obrigatorio',
  });

const schema = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('chapa'),
    mensagens: z.array(mensagemSchema).min(1).max(28),
  }),
  z.object({
    tipo: z.literal('bloco'),
    blocos: z.array(blocoSchema).min(1).max(30),
  }),
]);

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados invalidos', detalhes: parsed.error.format() },
        { status: 400 }
      );
    }

    const supabase = createServerClient();
    const storage = createStorageClient();
    const pedidoIds: string[] = [];

    if (parsed.data.tipo === 'chapa') {
      // 1 pedido por mensagem (cada um com seu cliente)
      for (const msg of parsed.data.mensagens) {
        const linhas = [msg.linha1, msg.linha2, msg.linha3].filter(Boolean);
        // hasPersonalization (uniquebox.ts) exige prefixo "LineN:" pra reconhecer
        // a mensagem e gerar SVG. Mantemos o formato igual ao que vem do Tiny/Shopify.
        const personalizacao = linhas.map((l, i) => `Line${i + 1}: ${l}`).join('\n');

        const { data: pedido, error } = await supabase
          .from('pedidos')
          .insert({
            tiny_pedido_id: Date.now() + Math.floor(Math.random() * 1_000_000),
            numero: 0,
            data_pedido: new Date().toISOString().split('T')[0],
            nome_ecommerce: 'Avulso',
            linha_produto: 'uniquebox',
            status: 'pronto_producao',
            nome_cliente: msg.cliente,
            is_avulso: true,
          })
          .select()
          .single();

        if (error || !pedido) {
          return NextResponse.json({ error: error?.message ?? 'Falha ao criar pedido' }, { status: 500 });
        }

        await supabase.from('itens_producao').insert({
          pedido_id: pedido.id,
          modelo: 'UniqueBox Avulso',
          personalizacao,
          has_personalizacao: !!personalizacao,
        });
        pedidoIds.push(pedido.id);
      }
    } else {
      // bloco: 1 pedido por bloco, cada um com 1 item + 1 foto
      for (const b of parsed.data.blocos) {
        const { data: pedido, error: pedidoError } = await supabase
          .from('pedidos')
          .insert({
            tiny_pedido_id: Date.now() + Math.floor(Math.random() * 1_000_000),
            numero: 0,
            data_pedido: new Date().toISOString().split('T')[0],
            nome_ecommerce: 'Avulso',
            linha_produto: 'uniquebox',
            status: 'pronto_producao',
            nome_cliente: b.cliente,
            is_avulso: true,
          })
          .select()
          .single();

        if (pedidoError || !pedido) {
          return NextResponse.json({ error: pedidoError?.message ?? 'Falha ao criar pedido' }, { status: 500 });
        }

        const { data: item, error: itemError } = await supabase
          .from('itens_producao')
          .insert({
            pedido_id: pedido.id,
            modelo: 'Blocos Tipo Lego Com Foto Personalizada - 39 Peças | 10x15cm',
            personalizacao: '',
            has_personalizacao: true,
            tem_fotos_bloco: true,
            tamanho_bloco: 'P',
            sku: 'UB325',
          })
          .select()
          .single();

        if (itemError || !item) {
          return NextResponse.json({ error: itemError?.message ?? 'Falha ao criar item' }, { status: 500 });
        }

        // Foto: se foi upload (foto_storage_path), ja esta no Storage — registra como 'baixada'.
        // Se eh URL, baixa via downloadAndStore (mesmo helper do fluxo regular).
        if (b.foto_storage_path) {
          // Pega tamanho do arquivo no Storage pra registrar metadado
          const { data: fileInfo } = await storage.storage
            .from('bloco-fotos')
            .download(b.foto_storage_path);
          const tamanho = fileInfo ? (await fileInfo.arrayBuffer()).byteLength : 0;

          await supabase.from('fotos_bloco').insert({
            item_id: item.id,
            posicao: 1,
            shopify_url: '',
            storage_path: b.foto_storage_path,
            tamanho_bytes: tamanho,
            content_type: 'image/jpeg',
            status: 'baixada',
            baixada_em: new Date().toISOString(),
          });
        } else if (b.foto_url) {
          // Cria a row primeiro (status pendente) e baixa depois
          const { data: foto, error: fotoError } = await supabase
            .from('fotos_bloco')
            .insert({
              item_id: item.id,
              posicao: 1,
              shopify_url: b.foto_url,
              status: 'pendente',
            })
            .select()
            .single();

          if (fotoError || !foto) {
            return NextResponse.json({ error: fotoError?.message ?? 'Falha ao criar foto' }, { status: 500 });
          }

          try {
            const r = await downloadAndStore({
              pedido_id: pedido.id,
              item_id: item.id,
              posicao: 1,
              shopify_url: b.foto_url,
            });
            await supabase
              .from('fotos_bloco')
              .update({
                storage_path: r.storage_path,
                tamanho_bytes: r.tamanho_bytes,
                content_type: r.content_type,
                status: 'baixada',
                baixada_em: new Date().toISOString(),
              })
              .eq('id', foto.id);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await supabase
              .from('fotos_bloco')
              .update({ status: 'erro', erro_detalhe: msg })
              .eq('id', foto.id);
            return NextResponse.json(
              { error: `Falha ao baixar foto: ${msg}` },
              { status: 502 }
            );
          }
        }

        pedidoIds.push(pedido.id);
      }
    }

    if (pedidoIds.length === 0) {
      return NextResponse.json({ error: 'Nenhum pedido criado' }, { status: 400 });
    }

    // Cria lote unificado e dispara producao
    const { loteId } = await createProductionBatch(pedidoIds, authResult.id);

    // Cria expedicao pra aparecer no kanban
    await supabase.from('expedicoes').insert({
      lote_id: loteId,
      forma_frete: 'Avulso',
      nf_ids: [],
      status: 'pendente',
    });

    // Espera arquivos serem gerados
    await new Promise((r) => setTimeout(r, 800));

    const { data: arquivos } = await supabase
      .from('arquivos')
      .select('id, tipo, nome_arquivo')
      .eq('lote_id', loteId);

    return NextResponse.json({
      lote_id: loteId,
      total_pedidos: pedidoIds.length,
      arquivos: (arquivos ?? []).map((a) => ({
        id: a.id,
        tipo: a.tipo,
        nome: a.nome_arquivo,
        url: `/api/arquivos/${a.id}/download`,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

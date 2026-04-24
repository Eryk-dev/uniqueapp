/**
 * Batch production processor.
 * Replaces Flask API batch routes — runs entirely within Next.js.
 */
import { createServerClient } from "@/lib/supabase/server";
import {
  generateUniqueBoxSvg,
  generateUniqueBoxPdf,
  hasPersonalization,
  type UniqueBoxMessage,
} from "./uniquebox";
import {
  expandNames,
  generateMoldSvgs,
  generateUniqueKidsPdf,
  type UniqueKidsOrder,
} from "./uniquekids";
import {
  renderBlocoSvgs,
  packFotos,
  type FotoToPlace,
} from "./bloco";
import { generateBlocoPdf } from "./bloco-pdf";

interface BatchResult {
  success: boolean;
  lote_id: string;
  arquivos: Array<{ tipo: string; storage_path: string }>;
  itens_sucesso: number;
  itens_erro: number;
  expedition_data: Record<string, { nf_ids: number[] }>;
}

function getStoragePath(loteId: string): string {
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${month}/${day}/${loteId}`;
}

/**
 * Carrega fotos de um lote em formato pronto pro packing.
 * Retorna itens estendidos com metadata de pedido/NF pra usar no PDF.
 */
async function loadFotosForLote(loteId: string): Promise<Array<
  FotoToPlace & {
    nome_cliente: string;
    forma_frete: string;
    tiny_pedido_id: number | null;
    numero_nf: number | null;
    numero_pedido: number | null;
  }
>> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('itens_producao')
    .select(`
      id,
      pedido_id,
      fotos_bloco (id, posicao, storage_path, status),
      pedidos!inner (id, numero, tiny_pedido_id, nome_cliente, forma_frete, notas_fiscais(tiny_nf_id))
    `)
    .eq('lote_id', loteId)
    .ilike('modelo', '%bloco%');

  if (error) throw new Error(`Erro ao buscar fotos do lote: ${error.message}`);

  const results: Array<
    FotoToPlace & {
      nome_cliente: string;
      forma_frete: string;
      tiny_pedido_id: number | null;
      numero_nf: number | null;
      numero_pedido: number | null;
    }
  > = [];

  for (const item of (data ?? [])) {
    // Supabase join typing: pedidos pode vir como array ou objeto
    const pedidoArr = Array.isArray(item.pedidos) ? item.pedidos : [item.pedidos];
    const pedido = pedidoArr[0] as unknown as {
      id: string;
      numero: number | null;
      tiny_pedido_id: number | null;
      nome_cliente: string | null;
      forma_frete: string | null;
      notas_fiscais: Array<{ tiny_nf_id: number }> | null;
    } | undefined;

    if (!pedido) continue;

    const nfId = pedido.notas_fiscais?.[0]?.tiny_nf_id ?? 0;
    const fotos = (item.fotos_bloco as Array<{ id: string; posicao: number; storage_path: string | null; status: string }>) ?? [];

    for (const foto of fotos) {
      if (foto.status !== 'baixada' || !foto.storage_path) continue;
      const { data: pub } = supabase.storage.from('bloco-fotos').getPublicUrl(foto.storage_path);
      results.push({
        foto_id: foto.id,
        item_id: item.id,
        pedido_id: item.pedido_id,
        nf_id: nfId,
        posicao: foto.posicao,
        public_url: pub.publicUrl,
        nome_cliente: pedido.nome_cliente ?? '',
        forma_frete: pedido.forma_frete ?? '',
        tiny_pedido_id: pedido.tiny_pedido_id,
        numero_nf: nfId || null,
        numero_pedido: pedido.numero,
      });
    }
  }

  // Ordenar: nf_id ASC, pedido_id ASC, posicao ASC
  results.sort(
    (a, b) =>
      a.nf_id - b.nf_id ||
      a.pedido_id.localeCompare(b.pedido_id) ||
      a.posicao - b.posicao
  );
  return results;
}

/**
 * Process a UniqueBox production batch.
 */
export async function processUniqueBoxBatch(loteId: string): Promise<BatchResult> {
  const supabase = createServerClient();

  // 1. Read batch items
  const { data: rawItems } = await supabase
    .from("itens_producao")
    .select("*, pedidos(linha_produto, forma_frete, id_forma_frete, id_transportador, nome_cliente, tiny_pedido_id)")
    .eq("lote_id", loteId)
    .eq("status", "pendente");

  const items = (rawItems ?? []).filter(
    (i: Record<string, unknown>) =>
      (i as { pedidos?: { linha_produto?: string } }).pedidos?.linha_produto === "uniquebox"
  );

  if (!items.length) throw new Error("No items found for batch");

  await supabase.from("eventos").insert({
    lote_id: loteId,
    tipo: "api_call",
    descricao: `Iniciando geracao UniqueBox — ${items.length} itens`,
    ator: "sistema",
  });

  // 2. Build messages
  const messages: UniqueBoxMessage[] = items.map((item: Record<string, unknown>) => {
    const pedido = item.pedidos as Record<string, unknown> | undefined;
    return {
      mensagem: (item.personalizacao as string) ?? "",
      cliente: (pedido?.nome_cliente as string) ?? "",
      modelo: (item.modelo as string) ?? "",
      idNF: item.tiny_nf_id as number,
      notaFiscal: item.numero_nf as number,
      formaEnvio: (pedido?.forma_frete as string) ?? "",
      pedidoId: pedido?.tiny_pedido_id as number,
      idFormaFrete: pedido?.id_forma_frete as number,
      _item_id: item.id as string,
      _pedido_id: item.pedido_id as string,
    };
  });

  // 3. Sort: personalized first
  messages.sort((a, b) => {
    const aP = hasPersonalization(a.mensagem) ? 0 : 1;
    const bP = hasPersonalization(b.mensagem) ? 0 : 1;
    return aP - bP;
  });

  // 4. Build expedition data
  const freightGroups: Record<string, { nf_ids: number[]; seen: Set<number> }> = {};
  for (const msg of messages) {
    const forma = (msg.formaEnvio ?? "").trim();
    const idNf = msg.idNF;
    if (forma && idNf) {
      if (!freightGroups[forma]) freightGroups[forma] = { nf_ids: [], seen: new Set() };
      if (!freightGroups[forma]!.seen.has(idNf)) {
        freightGroups[forma]!.seen.add(idNf);
        freightGroups[forma]!.nf_ids.push(idNf);
      }
    }
  }
  const expeditionData: Record<string, { nf_ids: number[] }> = {};
  for (const [forma, data] of Object.entries(freightGroups)) {
    expeditionData[forma] = { nf_ids: data.nf_ids };
  }

  // 4b. Separar boxItems (sem "bloco") de blocoItems
  const boxItemIds = new Set(
    items.filter((i: Record<string, unknown>) =>
      !String(i.modelo ?? '').toLowerCase().includes('bloco')
    ).map((i: Record<string, unknown>) => i.id as string)
  );

  const boxMessages = messages.filter((m) => boxItemIds.has(m._item_id ?? ''));

  // 5. Generate files
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const pdfFilename = `conferencia_${timestamp}.pdf`;
  const storagePrefix = getStoragePath(loteId);
  const bucket = "uniquebox-files";
  const arquivosResult: Array<{ tipo: string; storage_path: string }> = [];

  // 5a. UniqueBox chapa texto (só se houver boxItems personalizadas)
  if (boxMessages.length > 0) {
    const svgContent = generateUniqueBoxSvg(boxMessages);
    if (svgContent) {
      const svgFilename = `chapa_unica_${timestamp}.svg`;
      const svgBuffer = Buffer.from(svgContent, "utf-8");
      const svgPath = `${storagePrefix}/${svgFilename}`;
      await supabase.storage.from(bucket).upload(svgPath, svgBuffer, {
        contentType: "image/svg+xml",
      });
      await supabase.from("arquivos").insert({
        lote_id: loteId,
        tipo: "svg",
        nome_arquivo: svgFilename,
        storage_path: svgPath,
        storage_bucket: bucket,
        tamanho_bytes: svgBuffer.length,
      });
      arquivosResult.push({ tipo: "svg", storage_path: svgPath });
    }
  }

  // 5b. Chapas de blocos (se houver itens de bloco)
  const fotos = await loadFotosForLote(loteId);
  let blocoMapa: ReturnType<typeof renderBlocoSvgs>['mapa'] = [];
  const thumbnails = new Map<string, Buffer>();
  if (fotos.length > 0) {
    const packed = packFotos(
      fotos.map((f) => ({
        foto_id: f.foto_id,
        item_id: f.item_id,
        pedido_id: f.pedido_id,
        nf_id: f.nf_id,
        posicao: f.posicao,
        public_url: f.public_url,
      }))
    );
    const { svgs, mapa } = renderBlocoSvgs(packed, timestamp);
    blocoMapa = mapa;

    // Upload de cada SVG de bloco
    for (const svg of svgs) {
      const svgPath = `${storagePrefix}/${svg.filename}`;
      const svgBuffer = Buffer.from(svg.content, "utf-8");
      await supabase.storage.from(bucket).upload(svgPath, svgBuffer, {
        contentType: "image/svg+xml",
      });
      await supabase.from("arquivos").insert({
        lote_id: loteId,
        tipo: "svg",
        nome_arquivo: svg.filename,
        storage_path: svgPath,
        storage_bucket: bucket,
        tamanho_bytes: svgBuffer.length,
      });
      arquivosResult.push({ tipo: "svg", storage_path: svgPath });
    }

    // Baixa thumbnails pras fotos do mapa (pra usar no PDF)
    for (const m of mapa) {
      try {
        const res = await fetch(m.public_url);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          thumbnails.set(m.foto_id, buf);
        }
      } catch {
        // thumbnail opcional; PDF segue sem
      }
    }
  }

  // 5c. PDF de conferência — blocos OU UniqueBox (baseado em tipo do lote)
  const pdfBuffer = fotos.length > 0
    ? await generateBlocoPdf({
        mapa: blocoMapa,
        extraInfo: new Map(
          fotos.map((f) => [
            f.foto_id,
            {
              nome_cliente: f.nome_cliente,
              numero_pedido: f.numero_pedido ?? 0,
              numero_nf: f.numero_nf,
              forma_frete: f.forma_frete,
              tiny_pedido_id: f.tiny_pedido_id,
              thumbnail_bytes: thumbnails.get(f.foto_id) ?? Buffer.alloc(0),
            },
          ])
        ),
      })
    : await generateUniqueBoxPdf(boxMessages);

  const pdfPath = `${storagePrefix}/${pdfFilename}`;
  await supabase.storage.from(bucket).upload(pdfPath, pdfBuffer, {
    contentType: "application/pdf",
  });
  await supabase.from("arquivos").insert({
    lote_id: loteId,
    tipo: "pdf",
    nome_arquivo: pdfFilename,
    storage_path: pdfPath,
    storage_bucket: bucket,
    tamanho_bytes: pdfBuffer.length,
  });
  arquivosResult.push({ tipo: "pdf", storage_path: pdfPath });

  // 7. Update item statuses
  let itensSucesso = 0;
  let itensErro = 0;

  for (const msg of messages) {
    try {
      await supabase
        .from("itens_producao")
        .update({ status: "produzido" })
        .eq("id", msg._item_id);
      itensSucesso++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      await supabase
        .from("itens_producao")
        .update({ status: "erro", erro_detalhe: errMsg })
        .eq("id", msg._item_id);
      itensErro++;
    }
  }

  // 8. Update batch status
  const batchStatus = itensErro === 0 ? "concluido" : "erro_parcial";
  await supabase
    .from("lotes_producao")
    .update({
      itens_sucesso: itensSucesso,
      itens_erro: itensErro,
      status: batchStatus,
      completed_at: new Date().toISOString(),
    })
    .eq("id", loteId);

  // 9. Pedidos status is updated when operator marks expedition as finalizado

  await supabase.from("eventos").insert({
    lote_id: loteId,
    tipo: "file_generated",
    descricao: `UniqueBox gerado: ${itensSucesso} sucesso, ${itensErro} erro`,
    dados: { arquivos: arquivosResult, itens_sucesso: itensSucesso, itens_erro: itensErro },
    ator: "sistema",
  });

  return {
    success: true,
    lote_id: loteId,
    arquivos: arquivosResult,
    itens_sucesso: itensSucesso,
    itens_erro: itensErro,
    expedition_data: expeditionData,
  };
}

/**
 * Process a UniqueKids production batch.
 */
export async function processUniqueKidsBatch(loteId: string): Promise<BatchResult> {
  const supabase = createServerClient();

  // 1. Read batch items
  const { data: rawItems } = await supabase
    .from("itens_producao")
    .select("*, pedidos(linha_produto, forma_frete, id_forma_frete, id_transportador, nome_cliente, tiny_pedido_id)")
    .eq("lote_id", loteId)
    .eq("status", "pendente");

  const items = (rawItems ?? []).filter(
    (i: Record<string, unknown>) =>
      (i as { pedidos?: { linha_produto?: string } }).pedidos?.linha_produto === "uniquekids"
  );

  if (!items.length) throw new Error("No items found for batch");

  await supabase.from("eventos").insert({
    lote_id: loteId,
    tipo: "api_call",
    descricao: `Iniciando geracao UniqueKids — ${items.length} itens`,
    ator: "sistema",
  });

  // 2. Convert to orders format and expand names
  let orders: UniqueKidsOrder[] = items.map((item: Record<string, unknown>) => {
    const pedido = item.pedidos as Record<string, unknown> | undefined;
    return {
      "ID NF": item.tiny_nf_id as number,
      "Numero NF": item.numero_nf as number,
      Molde: (item.molde as string) ?? "",
      Fonte: (item.fonte as string) ?? "",
      "NOME (PERSONAL)": (item.personalizacao as string) ?? "",
      Modelo: (item.modelo as string) ?? "",
      "Forma frete": (pedido?.forma_frete as string) ?? "",
      "Nome Cliente": (pedido?.nome_cliente as string) ?? "",
      "ID pedido": pedido?.tiny_pedido_id as number,
      idFormaFrete: pedido?.id_forma_frete as number,
      _item_id: item.id as string,
      _pedido_id: item.pedido_id as string,
    };
  });

  // Expand multi-name orders
  const expanded: UniqueKidsOrder[] = [];
  for (const order of orders) {
    expanded.push(...expandNames(order));
  }
  orders = expanded;

  // 3. Sort by NF ID and build expedition data
  orders.sort((a, b) => String(a["ID NF"] ?? "").localeCompare(String(b["ID NF"] ?? "")));

  const freightGroups: Record<string, { nf_ids: number[]; seen: Set<number> }> = {};
  for (const order of orders) {
    const forma = (order["Forma frete"] ?? "").trim();
    const idNf = order["ID NF"] as number;
    if (forma && idNf) {
      if (!freightGroups[forma]) freightGroups[forma] = { nf_ids: [], seen: new Set() };
      if (!freightGroups[forma]!.seen.has(idNf)) {
        freightGroups[forma]!.seen.add(idNf);
        freightGroups[forma]!.nf_ids.push(idNf);
      }
    }
  }
  const expeditionData: Record<string, { nf_ids: number[] }> = {};
  for (const [forma, data] of Object.entries(freightGroups)) {
    expeditionData[forma] = { nf_ids: data.nf_ids };
  }

  // 4. Group by mold and generate SVGs
  const moldGroups: Record<string, UniqueKidsOrder[]> = {};
  for (const order of orders) {
    const mold = (order.Molde ?? "").trim();
    if (mold) {
      if (!moldGroups[mold]) moldGroups[mold] = [];
      moldGroups[mold]!.push(order);
    }
  }

  const storagePrefix = getStoragePath(loteId);
  const bucket = "uniquekids-files";
  const arquivosResult: Array<{ tipo: string; storage_path: string }> = [];

  for (const [mold, group] of Object.entries(moldGroups)) {
    if (mold.toUpperCase() === "PD") continue;

    try {
      const svgs = generateMoldSvgs(group);
      for (const svg of svgs) {
        const svgBuffer = Buffer.from(svg.content, "utf-8");
        const remotePath = `${storagePrefix}/${svg.filename}`;
        await supabase.storage.from(bucket).upload(remotePath, svgBuffer, {
          contentType: "image/svg+xml",
        });
        await supabase.from("arquivos").insert({
          lote_id: loteId,
          tipo: "svg",
          nome_arquivo: svg.filename,
          storage_path: remotePath,
          storage_bucket: bucket,
          tamanho_bytes: svgBuffer.length,
        });
        arquivosResult.push({ tipo: "svg", storage_path: remotePath });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`Error generating SVG for mold ${mold}:`, err);
      await supabase.from("eventos").insert({
        lote_id: loteId,
        tipo: "erro",
        descricao: `Falha ao gerar SVG do molde ${mold}: ${errMsg}`,
        dados: { mold, itens: group.length, error: errMsg },
        ator: "sistema",
      });
    }
  }

  // 5. Generate unified conference PDF
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const pdfFilename = `folha_conferencia_${timestamp}.pdf`;
  const pdfBuffer = await generateUniqueKidsPdf(orders);
  const remotePdfPath = `${storagePrefix}/${pdfFilename}`;

  await supabase.storage.from(bucket).upload(remotePdfPath, pdfBuffer, {
    contentType: "application/pdf",
  });
  await supabase.from("arquivos").insert({
    lote_id: loteId,
    tipo: "pdf",
    nome_arquivo: pdfFilename,
    storage_path: remotePdfPath,
    storage_bucket: bucket,
    tamanho_bytes: pdfBuffer.length,
  });
  arquivosResult.push({ tipo: "pdf", storage_path: remotePdfPath });

  // 6. Update item statuses (map back to original item IDs)
  const originalItemIds = Array.from(new Set(items.map((i: Record<string, unknown>) => i.id as string)));
  let itensSucesso = 0;
  let itensErro = 0;

  for (const itemId of originalItemIds) {
    try {
      await supabase
        .from("itens_producao")
        .update({ status: "produzido" })
        .eq("id", itemId);
      itensSucesso++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      await supabase
        .from("itens_producao")
        .update({ status: "erro", erro_detalhe: errMsg })
        .eq("id", itemId);
      itensErro++;
    }
  }

  // 7. Update batch and pedidos
  const batchStatus = itensErro === 0 ? "concluido" : "erro_parcial";
  await supabase
    .from("lotes_producao")
    .update({
      itens_sucesso: itensSucesso,
      itens_erro: itensErro,
      status: batchStatus,
      completed_at: new Date().toISOString(),
    })
    .eq("id", loteId);

  // Pedidos status is updated when operator marks expedition as finalizado

  await supabase.from("eventos").insert({
    lote_id: loteId,
    tipo: "file_generated",
    descricao: `UniqueKids gerado: ${itensSucesso} sucesso, ${itensErro} erro`,
    dados: { arquivos: arquivosResult, itens_sucesso: itensSucesso, itens_erro: itensErro },
    ator: "sistema",
  });

  return {
    success: true,
    lote_id: loteId,
    arquivos: arquivosResult,
    itens_sucesso: itensSucesso,
    itens_erro: itensErro,
    expedition_data: expeditionData,
  };
}

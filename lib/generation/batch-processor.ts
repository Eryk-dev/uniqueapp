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

  // 5. Generate files
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const svgFilename = `chapa_unica_${timestamp}.svg`;
  const pdfFilename = `conferencia_${timestamp}.pdf`;

  const svgContent = generateUniqueBoxSvg(messages);
  const pdfBuffer = await generateUniqueBoxPdf(messages);

  // 6. Upload to Supabase Storage
  const storagePrefix = getStoragePath(loteId);
  const bucket = "uniquebox-files";
  const arquivosResult: Array<{ tipo: string; storage_path: string }> = [];

  // Upload PDF
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

  // Upload SVG (if generated)
  if (svgContent) {
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
      console.error(`Error generating SVG for mold ${mold}:`, err);
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

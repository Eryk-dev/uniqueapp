/**
 * Batch production processor.
 * Replaces Flask API batch routes — runs entirely within Next.js.
 */
import { createServerClient, createStorageClient } from "@/lib/supabase/server";
import {
  generateUniqueBoxSvgs,
  generateUniqueBoxPdf,
  formatPlateMessage,
  type UniqueBoxMessage,
} from "./uniquebox";
import {
  generateConferenciaUnificada,
  slotLabel,
  type UnifiedRow,
} from "./conferencia-unificada";
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
import { renderBlocoPngs } from "./bloco-png";
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
 * Formata um timestamp do Postgres (timestamptz/ISO) em dd/MM/yyyy HH:mm no
 * fuso de Sao Paulo — usado no titulo das folhas de conferencia ("Exp 123 — 12/05/2026 14:32").
 * Retorna null quando o input nao parseia, pra deixar o titulo cair no fallback sem data.
 */
function formatDataGeracaoBR(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  // Intl com pt-BR retorna "12/05/2026, 14:32" — removemos a virgula pro titulo ficar compacto.
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt).replace(",", "");
}

/**
 * Normaliza nf_ids num Map<number, posicao>. expedicoes.nf_ids e' bigint[]
 * no Postgres; o supabase-js as vezes serializa como string (preservando
 * precisao). Forca coercao numerica em ambos os lados pra evitar tipos
 * mistos no Map.get — sem isso o sort por nfOrder cai todo no fallback
 * MAX_SAFE_INTEGER e a ordem fica indefinida (etiquetas vs conferencia
 * vs SVG vs PNG saem desencontrados).
 */
function buildNfPos(nfOrder: ReadonlyArray<number | string> | null | undefined): Map<number, number> {
  const m = new Map<number, number>();
  (nfOrder ?? []).forEach((id, idx) => {
    const n = typeof id === "number" ? id : Number(id);
    if (Number.isFinite(n)) m.set(n, idx);
  });
  return m;
}
function nfPosOf(map: Map<number, number>, id: number | string | null | undefined): number {
  if (id == null) return Number.MAX_SAFE_INTEGER;
  const n = typeof id === "number" ? id : Number(id);
  if (!Number.isFinite(n)) return Number.MAX_SAFE_INTEGER;
  return map.get(n) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Carrega fotos de um lote em formato pronto pro packing.
 * Retorna itens estendidos com metadata de pedido/NF pra usar no PDF.
 */
async function loadFotosForLote(
  loteId: string,
  nfOrder?: ReadonlyArray<number | string>
): Promise<Array<
  FotoToPlace & {
    nome_cliente: string;
    forma_frete: string;
    tiny_pedido_id: number | null;
    /** Numero humano da NF (5 dígitos) — usado nas tabelas de conferencia. */
    numero_nf: number | null;
    /** ID interno do Tiny — usado pra ordenacao via nfOrder da expedicao. */
    tiny_nf_id: number | null;
    numero_pedido: number | null;
    /** P/M/G do bloco (UB325/UB326/UB327). null em items sem tamanho mapeado. */
    tamanho_bloco: 'P' | 'M' | 'G' | null;
  }
>> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('itens_producao')
    .select(`
      id,
      pedido_id,
      tamanho_bloco,
      fotos_bloco (id, posicao, storage_path, status),
      pedidos!inner (id, numero, tiny_pedido_id, nome_cliente, forma_frete, notas_fiscais(tiny_nf_id, numero_nf))
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
      tiny_nf_id: number | null;
      numero_pedido: number | null;
      tamanho_bloco: 'P' | 'M' | 'G' | null;
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
      notas_fiscais: Array<{ tiny_nf_id: number; numero_nf: number | null }> | null;
    } | undefined;

    if (!pedido) continue;

    const nf = pedido.notas_fiscais?.[0];
    const tinyNfId = nf?.tiny_nf_id ?? 0;
    const numeroNfHumano = nf?.numero_nf ?? null;
    const fotos = (item.fotos_bloco as Array<{ id: string; posicao: number; storage_path: string | null; status: string }>) ?? [];

    const storage = createStorageClient();
    for (const foto of fotos) {
      if (foto.status !== 'baixada' || !foto.storage_path) continue;
      const { data: pub } = storage.storage.from('bloco-fotos').getPublicUrl(foto.storage_path);
      results.push({
        foto_id: foto.id,
        item_id: item.id,
        pedido_id: item.pedido_id,
        nf_id: tinyNfId,
        posicao: foto.posicao,
        public_url: pub.publicUrl,
        nome_cliente: pedido.nome_cliente ?? '',
        forma_frete: pedido.forma_frete ?? '',
        tiny_pedido_id: pedido.tiny_pedido_id,
        numero_nf: numeroNfHumano,
        tiny_nf_id: tinyNfId || null,
        numero_pedido: pedido.numero,
        tamanho_bloco: (item as { tamanho_bloco?: 'P' | 'M' | 'G' | null }).tamanho_bloco ?? null,
      });
    }
  }

  // Ordenar pela ordem das etiquetas do Tiny (nfOrder) — fallback pra nf_id
  // numerico quando o lote nao esta ligado a uma expedicao com nf_ids salvo
  // (ex: avulso). Tie-breakers: pedido_id, posicao.
  const nfPos = buildNfPos(nfOrder);
  const usarNfOrder = nfPos.size > 0;
  const posOfNf = (nfId: number) =>
    usarNfOrder ? nfPosOf(nfPos, nfId) : nfId;

  results.sort(
    (a, b) =>
      posOfNf(a.nf_id) - posOfNf(b.nf_id) ||
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
  const storage = createStorageClient();

  // 1. Read batch items
  const { data: rawItems } = await supabase
    .from("itens_producao")
    .select("*, pedidos(linha_produto, forma_frete, id_forma_frete, id_transportador, nome_cliente, tiny_pedido_id, kits)")
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

  // Busca nfOrder + numero da expedicao numa unica query.
  // nfOrder = ordem das etiquetas no Tiny — usada pra ordenar messages, fotos
  // e conferencia consistentemente (a referencia eh sempre o que sai da impressora).
  const { data: expedicaoMeta } = await supabase
    .from("expedicoes")
    .select("nf_ids, numero_expedicao, created_at")
    .eq("lote_id", loteId)
    .single();
  // nf_ids no DB e' bigint[]; supabase-js as vezes serializa como string.
  // buildNfPos/nfPosOf normalizam pra Number nos dois lados pra evitar miss
  // no Map.get (que faria a ordem cair toda no fallback).
  const nfOrder = (expedicaoMeta?.nf_ids as Array<number | string> | null) ?? [];
  const nfPos = buildNfPos(nfOrder);
  const posOfNf = (nfId: number | string | null | undefined) =>
    nfPosOf(nfPos, nfId);

  // Mapa pedido_id -> kits (nomes de produtos-kit detectados em enrichOrder).
  // Usado pra injetar row "KIT" + fundo rosa na folha de conferencia.
  const pedidoKits = new Map<string, string[]>();
  for (const item of items) {
    const pedidoId = (item as { pedido_id: string }).pedido_id;
    const pedido = (item as { pedidos?: { kits?: string[] | null } }).pedidos;
    const kits = pedido?.kits ?? [];
    if (kits.length > 0 && !pedidoKits.has(pedidoId)) {
      pedidoKits.set(pedidoId, kits);
    }
  }

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

  // 3. Ordena pela ordem das etiquetas do Tiny (nfOrder), garantindo que SVG
  // do box, PDF de conferencia e PNG de bloco sigam a mesma sequencia.
  // O SVG so renderiza personalizadas (filter em generateUniqueBoxSvgs), mas
  // o filter preserva ordem — entao basta ordenar tudo aqui.
  messages.sort((a, b) => posOfNf(a.idNF) - posOfNf(b.idNF));

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
  const numeroExpedicao = expedicaoMeta?.numero_expedicao
    ? String(expedicaoMeta.numero_expedicao)
    : null;
  const dataGeracao = formatDataGeracaoBR(expedicaoMeta?.created_at as string | null | undefined);
  const expRef = numeroExpedicao ?? timestamp;

  const pdfFilename = `conferencia-${expRef}.pdf`;
  const storagePrefix = getStoragePath(loteId);
  const bucket = "uniquebox-files";
  const arquivosResult: Array<{ tipo: string; storage_path: string }> = [];

  // 5a. UniqueBox chapa texto (só se houver boxItems personalizadas)
  // Cada SVG cabe ate 28 mensagens; mais que isso vira N arquivos.
  if (boxMessages.length > 0) {
    const svgContents = generateUniqueBoxSvgs(boxMessages);
    for (let i = 0; i < svgContents.length; i++) {
      const svgContent = svgContents[i]!;
      const sufixo = svgContents.length > 1 ? `-${i + 1}` : "";
      const svgFilename = `box-${expRef}${sufixo}.svg`;
      const svgBuffer = Buffer.from(svgContent, "utf-8");
      const svgPath = `${storagePrefix}/${svgFilename}`;
      const { error: upErr } = await storage.storage.from(bucket).upload(svgPath, svgBuffer, {
        contentType: "image/svg+xml",
      });
      if (upErr) throw new Error(`Upload SVG falhou (${svgFilename}): ${upErr.message}`);
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
  // Output: PNG 8505x13938 @ 400 DPI (formato de producao pra impressao),
  // sem contornos pretos (eles sairiam na impressao). Ver lib/generation/bloco-png.ts.
  //
  // Geracao da chapa PNG e' SO pra Bloco P (10x15 — UB325). Tamanhos M/G/misto
  // ainda nao tem molde fisico; nesses lotes pulamos o PNG e geramos so o PDF
  // de conferencia + etiquetas. Ver classifyOrder em /api/producao/gerar.
  const blocoSizes = await (async () => {
    const { data } = await supabase
      .from("itens_producao")
      .select("tamanho_bloco, modelo")
      .eq("lote_id", loteId);
    const sizes = new Set<"P" | "M" | "G">();
    for (const it of (data ?? []) as Array<{ tamanho_bloco?: string | null; modelo?: string | null }>) {
      if (it.tamanho_bloco === "P" || it.tamanho_bloco === "M" || it.tamanho_bloco === "G") {
        sizes.add(it.tamanho_bloco);
      } else if ((it.modelo ?? "").toLowerCase().includes("bloco")) {
        sizes.add("P");
      }
    }
    return sizes;
  })();
  const skipChapaPng = blocoSizes.size > 0 && !(blocoSizes.size === 1 && blocoSizes.has("P"));

  const fotos = await loadFotosForLote(loteId, nfOrder);
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

    if (!skipChapaPng) {
      const { pngs, mapa, failures } = await renderBlocoPngs(packed, timestamp);
      blocoMapa = mapa;

      if (failures.length > 0) {
        console.warn(
          `[batch-processor] ${failures.length} foto(s) nao baixaram no lote ${loteId} — slots ficaram vazios.`
        );
        await supabase.from("eventos").insert({
          lote_id: loteId,
          tipo: "erro",
          descricao: `${failures.length} foto(s) nao baixaram apos retries — slots vazios na chapa`,
          dados: { failures },
          ator: "sistema",
        });
        // Marca itens das fotos que falharam pra revisao manual
        const failedItemIds = Array.from(new Set(failures.map((f) => f.item_id)));
        if (failedItemIds.length > 0) {
          await supabase
            .from("itens_producao")
            .update({ status: "erro", erro_detalhe: "foto_nao_baixou" })
            .in("id", failedItemIds);
        }
      }

      // Upload de cada PNG de bloco — renomeia pra bloco-{exp}[-N].png
      for (let i = 0; i < pngs.length; i++) {
        const png = pngs[i]!;
        const sufixo = pngs.length > 1 ? `-${i + 1}` : "";
        const pngFilename = `bloco-${expRef}${sufixo}.png`;
        const pngPath = `${storagePrefix}/${pngFilename}`;
        const { error: upErr } = await storage.storage.from(bucket).upload(pngPath, png.content, {
          contentType: "image/png",
        });
        if (upErr) throw new Error(`Upload PNG bloco falhou (${pngFilename}): ${upErr.message}`);
        await supabase.from("arquivos").insert({
          lote_id: loteId,
          tipo: "png",
          nome_arquivo: pngFilename,
          storage_path: pngPath,
          storage_bucket: bucket,
          tamanho_bytes: png.content.length,
        });
        arquivosResult.push({ tipo: "png", storage_path: pngPath });
      }
    } else {
      // Sem chapa fisica: PDF de conferencia ainda lista todas as fotos.
      // Construimos blocoMapa linear (1 "chapa" por pedido, slots sequenciais)
      // pra preservar a estrutura por pedido na conferencia.
      type PackedFotoEntry = (typeof packed)[number];
      const byPedido = new Map<string, PackedFotoEntry[]>();
      for (const p of packed) {
        if (!byPedido.has(p.pedido_id)) byPedido.set(p.pedido_id, []);
        byPedido.get(p.pedido_id)!.push(p);
      }
      let chapaIdx = 0;
      const linearMapa: typeof blocoMapa = [];
      for (const [, items] of Array.from(byPedido)) {
        items.forEach((p: PackedFotoEntry, slotIdx: number) => {
          linearMapa.push({
            foto_id: p.foto_id,
            item_id: p.item_id,
            pedido_id: p.pedido_id,
            nf_id: p.nf_id,
            posicao: p.posicao,
            chapa_index: chapaIdx,
            slot_index: slotIdx,
            public_url: p.public_url,
          });
        });
        chapaIdx++;
      }
      blocoMapa = linearMapa;

      await supabase.from("eventos").insert({
        lote_id: loteId,
        tipo: "api_call",
        descricao: `Chapa PNG pulada — lote contem bloco ${Array.from(blocoSizes).sort().join("/")} sem molde fisico ainda`,
        ator: "sistema",
      });
    }

    // Baixa thumbnails pras fotos (pra usar no PDF de conferencia, tanto com chapa quanto sem)
    for (const f of fotos) {
      try {
        const res = await fetch(f.public_url);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          thumbnails.set(f.foto_id, buf);
        }
      } catch {
        // thumbnail opcional; PDF segue sem
      }
    }
  }

  // 5c. PDF de conferência:
  // - box+bloco: tabela unica agrupada por pedido (conferencia-unificada)
  // - so bloco ou so box: PDF dedicado de cada um
  const temBloco = fotos.length > 0;
  const temBox = boxMessages.length > 0;

  let pdfBuffer: Buffer;

  if (temBloco && temBox) {
    // nfOrder ja foi carregado no inicio do batch — usado pelo PDF de conferencia
    // pra alinhar pedidos com a ordem das etiquetas Tiny.

    // Mapa pedido_id -> modelo (do item de bloco — pedidos box puros so apaream em boxMessages)
    const pedidoModeloBox = new Map<string, string>();
    for (const msg of boxMessages) {
      if (msg._pedido_id) pedidoModeloBox.set(msg._pedido_id, msg.modelo ?? "");
    }

    const unifiedRows: UnifiedRow[] = [];

    // Bloco primeiro (sorted por chapa+slot, mantido)
    const blocoSorted = [...blocoMapa].sort(
      (a, b) => a.chapa_index - b.chapa_index || a.slot_index - b.slot_index
    );
    for (const item of blocoSorted) {
      const f = fotos.find((x) => x.foto_id === item.foto_id);
      if (!f) continue;
      unifiedRows.push({
        pedidoId: item.pedido_id,
        numeroPedido: f.numero_pedido ?? "",
        cliente: f.nome_cliente,
        tipo: "Bloco",
        detalhe: `Chapa ${item.chapa_index + 1} / ${slotLabel(item.slot_index)} / Foto ${item.posicao}`,
        modelo: "",
        numeroNf: f.numero_nf ?? "",
        formaFrete: f.forma_frete,
        tinyPedidoId: f.tiny_pedido_id,
        tinyNfId: f.tiny_nf_id,
        thumbBuffer: thumbnails.get(item.foto_id),
        chapaIndex: item.chapa_index,
        tamanhoBloco: f.tamanho_bloco,
      });
    }

    // Box depois — busca numeroPedido do extraInfo do bloco quando o pedido tambem tem bloco
    const numeroPedidoPorPedidoId = new Map<string, number | null>();
    for (const f of fotos) {
      if (f.numero_pedido != null) numeroPedidoPorPedidoId.set(f.pedido_id, f.numero_pedido);
    }
    for (const msg of boxMessages) {
      const pedidoId = msg._pedido_id ?? "";
      unifiedRows.push({
        pedidoId,
        numeroPedido: numeroPedidoPorPedidoId.get(pedidoId) ?? "",
        cliente: msg.cliente ?? "",
        tipo: "Box",
        detalhe: formatPlateMessage(msg.mensagem).replace(/\n/g, " | "),
        modelo: msg.modelo ?? "",
        numeroNf: msg.notaFiscal ?? "",
        formaFrete: msg.formaEnvio ?? "",
        tinyPedidoId: typeof msg.pedidoId === "number" ? msg.pedidoId : null,
        tinyNfId: msg.idNF ?? null,
      });
    }

    pdfBuffer = await generateConferenciaUnificada({ rows: unifiedRows, nfOrder, pedidoKits, numeroExpedicao, dataGeracao });
  } else if (temBloco) {
    pdfBuffer = await generateBlocoPdf({
      mapa: blocoMapa,
      extraInfo: new Map(
        fotos.map((f) => [
          f.foto_id,
          {
            nome_cliente: f.nome_cliente,
            numero_pedido: f.numero_pedido ?? 0,
            numero_nf: f.numero_nf,
            tiny_nf_id: f.tiny_nf_id,
            forma_frete: f.forma_frete,
            tiny_pedido_id: f.tiny_pedido_id,
            thumbnail_bytes: thumbnails.get(f.foto_id) ?? Buffer.alloc(0),
            tamanho_bloco: f.tamanho_bloco,
          },
        ])
      ),
      pedidoKits,
      numeroExpedicao,
      dataGeracao,
    });
  } else {
    pdfBuffer = await generateUniqueBoxPdf(boxMessages, pedidoKits, numeroExpedicao, dataGeracao);
  }

  const pdfPath = `${storagePrefix}/${pdfFilename}`;
  const { error: pdfUpErr } = await storage.storage.from(bucket).upload(pdfPath, pdfBuffer, {
    contentType: "application/pdf",
  });
  if (pdfUpErr) throw new Error(`Upload PDF conferencia falhou (${pdfFilename}): ${pdfUpErr.message}`);
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
  const storage = createStorageClient();

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

  // Dedup itens duplicados por Tiny: quando a personalizacao tem multi-nome
  // ("Nome1: X, Nome2: Y"), o Tiny cria N items_producao com a mesma string,
  // e o expandNames abaixo gera N nomes — multiplicando N×N. Filtra antes pra
  // manter so 1 representante por (pedido, modelo, personalizacao). Restrito
  // a multi-nome pra nao afetar outros pacotes legitimos com itens repetidos
  // sem Nome* (ex: kit "Tarefas + ROTINA" que vem expandido por componente).
  const seenMultiNome = new Set<string>();
  orders = orders.filter((order) => {
    const personalizacao = (order["NOME (PERSONAL)"] as string) ?? "";
    if (!/Nome\d+:/i.test(personalizacao)) return true;
    const key = `${order._pedido_id ?? ""}|${order.Modelo ?? ""}|${personalizacao}`;
    if (seenMultiNome.has(key)) return false;
    seenMultiNome.add(key);
    return true;
  });

  // Expand multi-name orders
  const expanded: UniqueKidsOrder[] = [];
  for (const order of orders) {
    expanded.push(...expandNames(order));
  }
  orders = expanded;

  // 3. Sort to match label order (nf_ids salvo pela rota /producao/gerar na ordem do Tiny)
  const { data: expedicaoLote } = await supabase
    .from("expedicoes")
    .select("nf_ids, numero_expedicao, created_at")
    .eq("lote_id", loteId)
    .single();
  // nf_ids e' bigint[] no DB; supabase-js as vezes serializa como string.
  // buildNfPos/nfPosOf normalizam pra Number pra evitar miss no Map.get.
  const nfOrder = (expedicaoLote?.nf_ids as Array<number | string> | null) ?? [];
  const numeroExpedicaoKids = expedicaoLote?.numero_expedicao
    ? String(expedicaoLote.numero_expedicao)
    : null;
  const dataGeracaoKids = formatDataGeracaoBR(expedicaoLote?.created_at as string | null | undefined);
  const expRefKids = numeroExpedicaoKids
    ?? new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const nfPos = buildNfPos(nfOrder);
  orders.sort((a, b) => nfPosOf(nfPos, a["ID NF"] as number | string) - nfPosOf(nfPos, b["ID NF"] as number | string));

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
      // Renomeia pra nome-{molde}-{exp}[-N].svg (molde lowercase, espacos viram hifen)
      const moldSlug = mold.toLowerCase().replace(/\s+/g, "-");
      for (let i = 0; i < svgs.length; i++) {
        const svg = svgs[i]!;
        const sufixo = svgs.length > 1 ? `-${i + 1}` : "";
        const filename = `nome-${moldSlug}-${expRefKids}${sufixo}.svg`;
        const svgBuffer = Buffer.from(svg.content, "utf-8");
        const remotePath = `${storagePrefix}/${filename}`;
        const { error: upErr } = await storage.storage.from(bucket).upload(remotePath, svgBuffer, {
          contentType: "image/svg+xml",
        });
        if (upErr) throw new Error(`Upload SVG kids falhou (${filename}): ${upErr.message}`);
        await supabase.from("arquivos").insert({
          lote_id: loteId,
          tipo: "svg",
          nome_arquivo: filename,
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
  const pdfFilename = `conferencia-${expRefKids}.pdf`;
  const pdfBuffer = await generateUniqueKidsPdf(orders, numeroExpedicaoKids, dataGeracaoKids);
  const remotePdfPath = `${storagePrefix}/${pdfFilename}`;

  const { error: kidsPdfUpErr } = await storage.storage.from(bucket).upload(remotePdfPath, pdfBuffer, {
    contentType: "application/pdf",
  });
  if (kidsPdfUpErr) throw new Error(`Upload PDF conferencia kids falhou (${pdfFilename}): ${kidsPdfUpErr.message}`);
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

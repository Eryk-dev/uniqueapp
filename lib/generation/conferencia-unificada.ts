// lib/generation/conferencia-unificada.ts
// Conferência única pra lotes box+bloco: linhas agrupadas por pedido,
// bloco primeiro, box depois. Substitui a mesclagem de 2 PDFs.
import {
  createPdfDocument,
  finalizePdf,
  drawTable,
  drawSummaryTable,
  generateQRCode,
} from "./pdf-engine";

export interface UnifiedRow {
  pedidoId: string;
  numeroPedido: number | string;
  cliente: string;
  tipo: "Bloco" | "Box" | "KIT";
  detalhe: string;
  modelo: string;
  numeroNf: number | string;
  formaFrete: string;
  tinyPedidoId: number | null;
  /** ID interno do Tiny pra ordenacao via nfOrder. */
  tinyNfId?: number | null;
  thumbBuffer?: Buffer;
  /** Pra resumo "Fotos por chapa" (so bloco). */
  chapaIndex?: number;
}

/** Cor de fundo das rows de pedido com kit (ex: "Surpresa de Amor"). */
const KIT_HIGHLIGHT_COLOR = "#ffe0ec";

export interface ConferenciaUnificadaInput {
  rows: UnifiedRow[];
  /** Ordem das NFs (vinda da expedicao); pedidos sem match vao pro fim. */
  nfOrder?: number[];
  /**
   * Map pedidoId -> nomes dos produtos-kit (ex: "Kit Surpresa de Amor").
   * Pedidos que aparecem aqui ganham 1 row "KIT" por nome + fundo rosa em
   * todas as rows do grupo na folha de conferencia.
   */
  pedidoKits?: Map<string, string[]>;
}

export async function generateConferenciaUnificada(
  input: ConferenciaUnificadaInput
): Promise<Buffer> {
  const doc = createPdfDocument();

  doc.font("Helvetica-Bold").fontSize(14).text("Conferência — Box + Bloco", { align: "center" });
  doc.moveDown(0.5);

  // 1. Agrupa por pedido (preserva ordem de insercao das rows dentro de cada pedido)
  const byPedido = new Map<string, UnifiedRow[]>();
  for (const r of input.rows) {
    if (!byPedido.has(r.pedidoId)) byPedido.set(r.pedidoId, []);
    byPedido.get(r.pedidoId)!.push(r);
  }

  // 2. Ordena pedidos pela ordem da expedicao (nfOrder).
  // Pega o primeiro tinyNfId nao-nulo de cada pedido como referencia.
  const nfPos = new Map<number, number>();
  (input.nfOrder ?? []).forEach((id, idx) => nfPos.set(id, idx));

  const pedidosOrdenados = Array.from(byPedido.entries())
    .map(([pedidoId, rows]) => {
      const refTinyNfId = rows.find((r) => r.tinyNfId)?.tinyNfId ?? null;
      const pos = refTinyNfId != null ? nfPos.get(refTinyNfId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      return { pedidoId, rows, pos };
    })
    .sort((a, b) => a.pos - b.pos);

  // 3. Achata em uma lista linear; injeta row "KIT" por pedido com kit ANTES das
  // rows normais; marca rows de pedido com kit em highlightRows; gera boxGroups
  // por pedido (caixinha em volta) cobrindo KIT + items.
  type FlatRow = UnifiedRow & { __orderInPedido: number; __isKit?: boolean };
  const flat: FlatRow[] = [];
  const boxGroups: Array<{ start: number; end: number }> = [];
  const highlightRows = new Set<number>();

  for (const p of pedidosOrdenados) {
    const start = flat.length;
    const kits = input.pedidoKits?.get(p.pedidoId) ?? [];
    const ref = p.rows[0]!;

    // Row "KIT" — uma por kit detectado no pedido
    for (const kitNome of kits) {
      const kitIdx = flat.length;
      flat.push({
        pedidoId: p.pedidoId,
        numeroPedido: ref.numeroPedido,
        cliente: ref.cliente,
        tipo: "KIT",
        detalhe: kitNome,
        modelo: "",
        numeroNf: ref.numeroNf,
        formaFrete: ref.formaFrete,
        tinyPedidoId: ref.tinyPedidoId,
        tinyNfId: ref.tinyNfId,
        __orderInPedido: -1,
        __isKit: true,
      });
      highlightRows.add(kitIdx);
    }

    p.rows.forEach((r, idx) => {
      const flatIdx = flat.length;
      flat.push({ ...r, __orderInPedido: idx });
      if (kits.length > 0) highlightRows.add(flatIdx);
    });

    const end = flat.length - 1;
    if (end > start) boxGroups.push({ start, end });
  }

  // 4. Monta rows pra drawTable + cellImages (thumb + QR)
  const tableRows: Record<string, string | number>[] = [];
  const cellImages = new Map<string, Buffer>();

  for (let i = 0; i < flat.length; i++) {
    const r = flat[i]!;
    const hasKit = (input.pedidoKits?.get(r.pedidoId)?.length ?? 0) > 0;
    const pedidoLabel = hasKit ? `❤ ${r.numeroPedido}` : String(r.numeroPedido);

    tableRows.push({
      num: i + 1,
      pedido: pedidoLabel,
      cliente: r.cliente,
      tipo: r.tipo,
      detalhe: r.detalhe,
      nf: r.numeroNf,
      frete: r.formaFrete,
      thumb: "",
      qr: "",
    });

    if (r.thumbBuffer && r.thumbBuffer.length > 0) {
      cellImages.set(`${i}:thumb`, r.thumbBuffer);
    }

    // QR: inclui pra rows normais e pra row KIT (mesmo pedido)
    if (r.tinyPedidoId) {
      const url = String(r.formaFrete).trim().toLowerCase().includes("retirada")
        ? `https://erp.tiny.com.br/retirada#edit/${r.tinyPedidoId}`
        : `https://erp.tiny.com.br/vendas#edit/${r.tinyPedidoId}`;
      const qrBuf = await generateQRCode(url, 28);
      cellImages.set(`${i}:qr`, qrBuf);
    }
  }

  drawTable(doc, {
    columns: [
      { header: "#", key: "num", width: 22 },
      { header: "Pedido", key: "pedido", width: 50 },
      { header: "Cliente", key: "cliente", width: 90 },
      { header: "Tipo", key: "tipo", width: 35 },
      { header: "Detalhe", key: "detalhe", width: 145 },
      { header: "NF", key: "nf", width: 50 },
      { header: "Frete", key: "frete", width: 55 },
      { header: "Thumb", key: "thumb", width: 40 },
      { header: "QR", key: "qr", width: 40 },
    ],
    rows: tableRows,
    cellImages,
    boxGroups,
    highlightRows,
    highlightColor: KIT_HIGHLIGHT_COLOR,
  });

  doc.moveDown(1);

  // 5. Resumos no final — modelos (so box) + fotos por chapa (so bloco)
  const modelCounts = new Map<string, number>();
  for (const r of flat) {
    if (r.tipo !== "Box") continue;
    const m = r.modelo || "(sem modelo)";
    modelCounts.set(m, (modelCounts.get(m) ?? 0) + 1);
  }
  if (modelCounts.size > 0) {
    drawSummaryTable(doc, "Resumo de Modelos (Box)", modelCounts, "Modelo");
    doc.moveDown(0.5);
  }

  const chapaCounts = new Map<string, number>();
  for (const r of flat) {
    if (r.tipo !== "Bloco" || r.chapaIndex == null) continue;
    const k = `Chapa ${r.chapaIndex + 1}`;
    chapaCounts.set(k, (chapaCounts.get(k) ?? 0) + 1);
  }
  if (chapaCounts.size > 0) {
    drawSummaryTable(doc, "Fotos por chapa (Bloco)", chapaCounts, "Chapa");
    doc.moveDown(0.5);
  }

  const kitCount = input.pedidoKits
    ? Array.from(input.pedidoKits.values()).filter((k) => k.length > 0).length
    : 0;
  if (kitCount > 0) {
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#000000")
      .text(`❤ Pedidos com Kit Surpresa de Amor: ${kitCount}`, 40);
  }

  return finalizePdf(doc);
}

/**
 * Helper: converte slot_index (0-29) em label grid "a1".."f5".
 * (Mesma logica do bloco-pdf — duplicada pra evitar import circular.)
 */
export function slotLabel(slotIndex: number): string {
  const rowLetter = String.fromCharCode("a".charCodeAt(0) + Math.floor(slotIndex / 5));
  const colNumber = (slotIndex % 5) + 1;
  return `${rowLetter}${colNumber}`;
}

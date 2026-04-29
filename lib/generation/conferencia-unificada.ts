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
  tipo: "Bloco" | "Box";
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

export interface ConferenciaUnificadaInput {
  rows: UnifiedRow[];
  /** Ordem das NFs (vinda da expedicao); pedidos sem match vao pro fim. */
  nfOrder?: number[];
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

  // 3. Achata em uma lista linear; gera boxGroups por pedido (caixinha em volta)
  type FlatRow = UnifiedRow & { __orderInPedido: number };
  const flat: FlatRow[] = [];
  const boxGroups: Array<{ start: number; end: number }> = [];

  for (const p of pedidosOrdenados) {
    const start = flat.length;
    p.rows.forEach((r, idx) => flat.push({ ...r, __orderInPedido: idx }));
    const end = flat.length - 1;
    if (end > start) boxGroups.push({ start, end });
  }

  // 4. Monta rows pra drawTable + cellImages (thumb + QR)
  const tableRows: Record<string, string | number>[] = [];
  const cellImages = new Map<string, Buffer>();

  for (let i = 0; i < flat.length; i++) {
    const r = flat[i]!;
    tableRows.push({
      num: i + 1,
      pedido: r.numeroPedido,
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
      { header: "Pedido", key: "pedido", width: 45 },
      { header: "Cliente", key: "cliente", width: 90 },
      { header: "Tipo", key: "tipo", width: 35 },
      { header: "Detalhe", key: "detalhe", width: 150 },
      { header: "NF", key: "nf", width: 50 },
      { header: "Frete", key: "frete", width: 55 },
      { header: "Thumb", key: "thumb", width: 40 },
      { header: "QR", key: "qr", width: 40 },
    ],
    rows: tableRows,
    cellImages,
    boxGroups,
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

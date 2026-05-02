// lib/generation/bloco-pdf.ts
import {
  createPdfDocument,
  finalizePdf,
  drawTable,
  drawSummaryTable,
  generateQRCode,
} from './pdf-engine';
import type { GenerateBlocoResult } from './bloco';

export interface BlocoPdfInput {
  mapa: GenerateBlocoResult['mapa'];
  // Info adicional por foto para colunas do PDF
  extraInfo: Map<string, {
    nome_cliente: string;
    numero_pedido: number;
    /** Numero humano da NF (5 dígitos). */
    numero_nf: number | null;
    /** ID interno do Tiny — opcional, nao exibido. */
    tiny_nf_id?: number | null;
    forma_frete: string;
    tiny_pedido_id: number | null;
    thumbnail_bytes: Buffer;      // thumbnail pré-gerado (delegate ao caller)
  }>;
  /**
   * Map pedido_id -> nomes dos produtos-kit (ex: "Kit Surpresa de Amor").
   * Pedidos com kit ganham 1 row "KIT" antes do primeiro slot na tabela e
   * fundo rosa em todas as rows do pedido.
   */
  pedidoKits?: Map<string, string[]>;
}

const KIT_HIGHLIGHT_COLOR = '#ffe0ec';

/**
 * Converte slot_index (0-29) em label grid "a1".."f5".
 * Linhas = letras (a-f, top→bottom), colunas = números (1-5, left→right).
 * Casa com os rótulos desenhados nas bordas do SVG do molde.
 */
function slotLabel(slotIndex: number): string {
  const rowLetter = String.fromCharCode('a'.charCodeAt(0) + Math.floor(slotIndex / 5));
  const colNumber = (slotIndex % 5) + 1;
  return `${rowLetter}${colNumber}`;
}

/**
 * Gera o PDF de conferência de blocos: uma linha por foto.
 */
export async function generateBlocoPdf(input: BlocoPdfInput): Promise<Buffer> {
  const doc = createPdfDocument();

  doc.font('Helvetica-Bold').fontSize(14).text('Chapa de Blocos — Conferência', { align: 'center' });
  doc.moveDown(0.5);

  // Ordenar por chapa, slot
  const sorted = [...input.mapa].sort(
    (a, b) => a.chapa_index - b.chapa_index || a.slot_index - b.slot_index
  );

  const rows: Record<string, string | number>[] = [];
  const cellImages = new Map<string, Buffer>();
  const highlightRows = new Set<number>();
  const pedidosComKitInjetada = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i]!;
    const extra = input.extraInfo.get(item.foto_id);
    const kits = input.pedidoKits?.get(item.pedido_id) ?? [];
    const hasKit = kits.length > 0;

    // Injeta 1 row "KIT" por kit antes da primeira aparicao do pedido na tabela
    if (hasKit && !pedidosComKitInjetada.has(item.pedido_id)) {
      pedidosComKitInjetada.add(item.pedido_id);
      for (const kitNome of kits) {
        const kitIdx = rows.length;
        rows.push({
          num: rows.length + 1,
          chapa: '—',
          slot: 'KIT',
          cliente: extra?.nome_cliente ?? '',
          pedido: `❤ ${extra?.numero_pedido ?? ''}`,
          nf: extra?.numero_nf ?? '',
          posicao: kitNome,
          frete: extra?.forma_frete ?? '',
          thumb: '',
          qr: '',
        });
        highlightRows.add(kitIdx);
      }
    }

    const rowIdx = rows.length;
    const pedidoLabel = hasKit ? `❤ ${extra?.numero_pedido ?? ''}` : String(extra?.numero_pedido ?? '');
    rows.push({
      num: rowIdx + 1,
      chapa: `${item.chapa_index + 1}`,
      slot: slotLabel(item.slot_index),
      cliente: extra?.nome_cliente ?? '',
      pedido: pedidoLabel,
      nf: extra?.numero_nf ?? '',
      posicao: `Foto ${item.posicao}`,
      frete: extra?.forma_frete ?? '',
      thumb: '',
      qr: '',
    });
    if (hasKit) highlightRows.add(rowIdx);

    if (extra?.thumbnail_bytes && extra.thumbnail_bytes.length > 0) {
      cellImages.set(`${rowIdx}:thumb`, extra.thumbnail_bytes);
    }
    if (extra?.tiny_pedido_id) {
      const url = extra.forma_frete.trim().toLowerCase() === 'retirada'
        ? `https://erp.tiny.com.br/retirada#edit/${extra.tiny_pedido_id}`
        : `https://erp.tiny.com.br/vendas#edit/${extra.tiny_pedido_id}`;
      const qrBuf = await generateQRCode(url, 28);
      cellImages.set(`${rowIdx}:qr`, qrBuf);
    }
  }

  // Agrupa rows contiguas do mesmo pedido em boxes com tracado escuro.
  // So cria box quando o grupo tem 2+ rows. Inclui rows KIT (que sao injetadas
  // antes do primeiro slot do pedido — ficam contiguas com elas).
  const boxGroups: Array<{ start: number; end: number }> = [];
  let groupStartRow = 0;
  let prevPedidoNum: string | number | null = null;
  for (let i = 0; i <= rows.length; i++) {
    const currPedidoNum = i < rows.length ? rows[i]!.pedido : null;
    if (currPedidoNum !== prevPedidoNum) {
      if (prevPedidoNum != null && i - groupStartRow > 1) {
        boxGroups.push({ start: groupStartRow, end: i - 1 });
      }
      groupStartRow = i;
      prevPedidoNum = currPedidoNum;
    }
  }

  drawTable(doc, {
    columns: [
      { header: '#', key: 'num', width: 22 },
      { header: 'Chapa', key: 'chapa', width: 35 },
      { header: 'Slot', key: 'slot', width: 30 },
      { header: 'Thumb', key: 'thumb', width: 40 },
      { header: 'Cliente', key: 'cliente', width: 90 },
      { header: 'Pedido', key: 'pedido', width: 50 },
      { header: 'NF', key: 'nf', width: 45 },
      { header: 'Foto', key: 'posicao', width: 45 },
      { header: 'Frete', key: 'frete', width: 55 },
      { header: 'QR', key: 'qr', width: 45 },
    ],
    rows,
    cellImages,
    boxGroups,
    highlightRows,
    highlightColor: KIT_HIGHLIGHT_COLOR,
  });

  doc.moveDown(1);

  // Resumo: fotos por chapa
  const chapaCounts = new Map<string, number>();
  for (const item of sorted) {
    const k = `Chapa ${item.chapa_index + 1}`;
    chapaCounts.set(k, (chapaCounts.get(k) ?? 0) + 1);
  }
  drawSummaryTable(doc, 'Fotos por chapa', chapaCounts, 'Chapa');

  return finalizePdf(doc);
}

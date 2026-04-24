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
    numero_nf: number | null;
    forma_frete: string;
    tiny_pedido_id: number | null;
    thumbnail_bytes: Buffer;      // thumbnail pré-gerado (delegate ao caller)
  }>;
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

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i]!;
    const extra = input.extraInfo.get(item.foto_id);

    rows.push({
      num: i + 1,
      chapa: `${item.chapa_index + 1}`,
      slot: `${item.slot_index + 1}`,
      cliente: extra?.nome_cliente ?? '',
      pedido: extra?.numero_pedido ?? '',
      nf: extra?.numero_nf ?? '',
      posicao: `Foto ${item.posicao}`,
      frete: extra?.forma_frete ?? '',
      thumb: '',
      qr: '',
    });

    if (extra?.thumbnail_bytes && extra.thumbnail_bytes.length > 0) {
      cellImages.set(`${i}:thumb`, extra.thumbnail_bytes);
    }
    if (extra?.tiny_pedido_id) {
      const url = extra.forma_frete.trim().toLowerCase() === 'retirada'
        ? `https://erp.tiny.com.br/retirada#edit/${extra.tiny_pedido_id}`
        : `https://erp.tiny.com.br/vendas#edit/${extra.tiny_pedido_id}`;
      const qrBuf = await generateQRCode(url, 28);
      cellImages.set(`${i}:qr`, qrBuf);
    }
  }

  // Agrupa rows contíguas do mesmo pedido_id em boxes com traçado escuro.
  // Só cria box quando o pedido tem 2+ fotos (single-foto não precisa).
  const boxGroups: Array<{ start: number; end: number }> = [];
  let groupStart = 0;
  for (let i = 1; i <= sorted.length; i++) {
    const prevPedido = sorted[i - 1]?.pedido_id;
    const currPedido = i < sorted.length ? sorted[i]?.pedido_id : null;
    if (currPedido !== prevPedido) {
      if (i - groupStart > 1) {
        boxGroups.push({ start: groupStart, end: i - 1 });
      }
      groupStart = i;
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

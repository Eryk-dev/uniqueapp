// scripts/test-kit-surpresa-conferencia.ts
/**
 * Gera um PDF de teste da folha de conferencia mostrando como o destaque
 * do "Kit Surpresa de Amor" ficaria. Cobre os 3 cenarios: so box, so bloco
 * e box+bloco — cada um com 1 pedido normal e 1 pedido com kit, intercalados.
 *
 * Saida: tmp/conferencia-kit-surpresa.pdf
 *
 * Abrir: `open tmp/conferencia-kit-surpresa.pdf`
 */
import fs from 'fs';
import path from 'path';
import {
  createPdfDocument,
  finalizePdf,
  drawTable,
  generateQRCode,
} from '../lib/generation/pdf-engine';

const TMP_DIR = path.join(process.cwd(), 'tmp');
const OUTPUT = path.join(TMP_DIR, 'conferencia-kit-surpresa.pdf');

// Cor de fundo das rows do pedido com kit
const KIT_HIGHLIGHT_COLOR = '#ffe0ec';

// Detecta nome de produto que indica Kit Surpresa de Amor
function isKitSurpresa(produtoNome: string | null | undefined): boolean {
  if (!produtoNome) return false;
  return produtoNome.toLowerCase().includes('surpresa de amor');
}

// Mock de rows simulando o que generateConferenciaUnificada produz
type MockRow = {
  pedidoId: string;
  numeroPedido: number;
  cliente: string;
  tipo: 'Bloco' | 'Box';
  detalhe: string;
  numeroNf: number;
  formaFrete: string;
  tinyPedidoId: number;
  /** Lista de produtos do pedido — usada pra detectar kit. */
  produtos: string[];
};

const rows: MockRow[] = [
  // Pedido 12001 — NORMAL, so bloco
  {
    pedidoId: 'a1', numeroPedido: 12001, cliente: 'Maria Silva',
    tipo: 'Bloco', detalhe: 'Chapa 1 / a1 / Foto 1', numeroNf: 18234,
    formaFrete: 'Loggi', tinyPedidoId: 99001,
    produtos: ['Bloco P UB325'],
  },
  {
    pedidoId: 'a1', numeroPedido: 12001, cliente: 'Maria Silva',
    tipo: 'Bloco', detalhe: 'Chapa 1 / a2 / Foto 2', numeroNf: 18234,
    formaFrete: 'Loggi', tinyPedidoId: 99001,
    produtos: ['Bloco P UB325'],
  },

  // Pedido 12005 — KIT SURPRESA, so bloco
  {
    pedidoId: 'b2', numeroPedido: 12005, cliente: 'Ana Costa',
    tipo: 'Bloco', detalhe: 'Chapa 1 / a3 / Foto 1', numeroNf: 18235,
    formaFrete: 'Loggi', tinyPedidoId: 99005,
    produtos: ['Bloco P UB325', 'Kit Surpresa de Amor Romantico'],
  },
  {
    pedidoId: 'b2', numeroPedido: 12005, cliente: 'Ana Costa',
    tipo: 'Bloco', detalhe: 'Chapa 1 / a4 / Foto 2', numeroNf: 18235,
    formaFrete: 'Loggi', tinyPedidoId: 99005,
    produtos: ['Bloco P UB325', 'Kit Surpresa de Amor Romantico'],
  },
  {
    pedidoId: 'b2', numeroPedido: 12005, cliente: 'Ana Costa',
    tipo: 'Bloco', detalhe: 'Chapa 1 / a5 / Foto 3', numeroNf: 18235,
    formaFrete: 'Loggi', tinyPedidoId: 99005,
    produtos: ['Bloco P UB325', 'Kit Surpresa de Amor Romantico'],
  },

  // Pedido 12010 — KIT SURPRESA, so box
  {
    pedidoId: 'c3', numeroPedido: 12010, cliente: 'Joao Pereira',
    tipo: 'Box', detalhe: 'TE AMO MAR | NOSSO TUDO', numeroNf: 18236,
    formaFrete: 'PAC', tinyPedidoId: 99010,
    produtos: ['UniqueBox', 'Kit Surpresa de Amor Premium'],
  },

  // Pedido 12012 — NORMAL, box+bloco
  {
    pedidoId: 'd4', numeroPedido: 12012, cliente: 'Lucas Mendes',
    tipo: 'Bloco', detalhe: 'Chapa 1 / b1 / Foto 1', numeroNf: 18237,
    formaFrete: 'Loggi', tinyPedidoId: 99012,
    produtos: ['Bloco P UB325', 'UniqueBox'],
  },
  {
    pedidoId: 'd4', numeroPedido: 12012, cliente: 'Lucas Mendes',
    tipo: 'Box', detalhe: 'FELIZES PARA SEMPRE', numeroNf: 18237,
    formaFrete: 'Loggi', tinyPedidoId: 99012,
    produtos: ['Bloco P UB325', 'UniqueBox'],
  },

  // Pedido 12015 — KIT SURPRESA, box+bloco
  {
    pedidoId: 'e5', numeroPedido: 12015, cliente: 'Beatriz Souza',
    tipo: 'Bloco', detalhe: 'Chapa 1 / b2 / Foto 1', numeroNf: 18238,
    formaFrete: 'Sedex', tinyPedidoId: 99015,
    produtos: ['Bloco P UB325', 'UniqueBox', 'Kit Surpresa de Amor'],
  },
  {
    pedidoId: 'e5', numeroPedido: 12015, cliente: 'Beatriz Souza',
    tipo: 'Bloco', detalhe: 'Chapa 1 / b3 / Foto 2', numeroNf: 18238,
    formaFrete: 'Sedex', tinyPedidoId: 99015,
    produtos: ['Bloco P UB325', 'UniqueBox', 'Kit Surpresa de Amor'],
  },
  {
    pedidoId: 'e5', numeroPedido: 12015, cliente: 'Beatriz Souza',
    tipo: 'Box', detalhe: 'PRA SEMPRE NOSSO', numeroNf: 18238,
    formaFrete: 'Sedex', tinyPedidoId: 99015,
    produtos: ['Bloco P UB325', 'UniqueBox', 'Kit Surpresa de Amor'],
  },

  // Pedido 12020 — NORMAL, so box
  {
    pedidoId: 'f6', numeroPedido: 12020, cliente: 'Rafael Lima',
    tipo: 'Box', detalhe: 'NOSSO INFINITO', numeroNf: 18239,
    formaFrete: 'PAC', tinyPedidoId: 99020,
    produtos: ['UniqueBox'],
  },
];

async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const doc = createPdfDocument();
  doc.font('Helvetica-Bold').fontSize(14).text('Conferência — Box + Bloco (TESTE Kit Surpresa de Amor)', { align: 'center' });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(8).fillColor('#666666').text(
    'Pedidos com item "Surpresa de Amor" ganham 1 row "KIT" + fundo rosa em todas as rows do pedido.',
    { align: 'center' }
  );
  doc.fillColor('#000000');
  doc.moveDown(0.5);

  // Mapa pedidoId -> lista de kits (nomes dos produtos que sao Kit Surpresa)
  const kitsPorPedido = new Map<string, string[]>();
  for (const r of rows) {
    if (kitsPorPedido.has(r.pedidoId)) continue;
    const kits = r.produtos.filter(isKitSurpresa);
    if (kits.length > 0) kitsPorPedido.set(r.pedidoId, kits);
  }

  // Agrupa rows por pedido preservando ordem
  const byPedido = new Map<string, MockRow[]>();
  for (const r of rows) {
    if (!byPedido.has(r.pedidoId)) byPedido.set(r.pedidoId, []);
    byPedido.get(r.pedidoId)!.push(r);
  }

  // Build tableRows + highlightRows + boxGroups injetando 1 row de "Kit"
  // por pedido com kit, ANTES das rows normais. Tudo do pedido com kit recebe
  // fundo rosa (highlightRows).
  const tableRows: Record<string, string | number>[] = [];
  const cellImages = new Map<string, Buffer>();
  const highlightRows = new Set<number>();
  const boxGroups: Array<{ start: number; end: number }> = [];

  let displayNum = 0;
  for (const [pedidoId, pedidoRows] of Array.from(byPedido)) {
    const kits = kitsPorPedido.get(pedidoId);
    const isKit = kits != null && kits.length > 0;
    const refRow = pedidoRows[0]!;
    const groupStart = tableRows.length;

    // Row "Kit" — uma por kit (geralmente eh 1 so, mas suporta multiplos)
    if (isKit) {
      for (const kitNome of kits) {
        displayNum++;
        const idx = tableRows.length;
        tableRows.push({
          num: displayNum,
          pedido: `❤ ${refRow.numeroPedido}`,
          cliente: refRow.cliente,
          tipo: 'KIT',
          detalhe: kitNome,
          nf: refRow.numeroNf,
          frete: refRow.formaFrete,
          thumb: '',
          qr: '',
        });
        highlightRows.add(idx);
      }
    }

    // Rows normais (bloco/box) do pedido
    for (const r of pedidoRows) {
      displayNum++;
      const idx = tableRows.length;
      const pedidoLabel = isKit ? `❤ ${r.numeroPedido}` : String(r.numeroPedido);
      tableRows.push({
        num: displayNum,
        pedido: pedidoLabel,
        cliente: r.cliente,
        tipo: r.tipo,
        detalhe: r.detalhe,
        nf: r.numeroNf,
        frete: r.formaFrete,
        thumb: '',
        qr: '',
      });
      if (isKit) highlightRows.add(idx);

      const qrBuf = await generateQRCode(`https://erp.tiny.com.br/vendas#edit/${r.tinyPedidoId}`, 28);
      cellImages.set(`${idx}:qr`, qrBuf);
    }

    const groupEnd = tableRows.length - 1;
    if (groupEnd > groupStart) boxGroups.push({ start: groupStart, end: groupEnd });
  }

  drawTable(doc, {
    columns: [
      { header: '#', key: 'num', width: 22 },
      { header: 'Pedido', key: 'pedido', width: 50 },
      { header: 'Cliente', key: 'cliente', width: 90 },
      { header: 'Tipo', key: 'tipo', width: 35 },
      { header: 'Detalhe', key: 'detalhe', width: 145 },
      { header: 'NF', key: 'nf', width: 50 },
      { header: 'Frete', key: 'frete', width: 55 },
      { header: 'Thumb', key: 'thumb', width: 40 },
      { header: 'QR', key: 'qr', width: 40 },
    ],
    rows: tableRows,
    cellImages,
    boxGroups,
    highlightRows,
    highlightColor: KIT_HIGHLIGHT_COLOR,
  });

  doc.moveDown(1);
  doc.font('Helvetica').fontSize(9).fillColor('#444444').text(
    `Pedidos com Kit Surpresa: ${kitsPorPedido.size} de ${new Set(rows.map(r => r.pedidoId)).size}`,
    40
  );

  const buffer = await finalizePdf(doc);
  fs.writeFileSync(OUTPUT, buffer);
  console.log(`PDF de teste gerado em: ${OUTPUT}`);
  console.log(`Abrir com: open "${OUTPUT}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

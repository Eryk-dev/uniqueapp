/**
 * PDF generation engine using PDFKit.
 * Replaces Python ReportLab-based PDF generation from the Flask API.
 */
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

interface TableColumn {
  header: string;
  key: string;
  width: number;
}

interface TableOptions {
  columns: TableColumn[];
  rows: Record<string, string | number>[];
  x?: number;
  y?: number;
  headerBg?: string;
  headerColor?: string;
  rowHeight?: number;
  fontSize?: number;
  highlightRows?: Set<number>;
  highlightColor?: string;
  boxGroups?: Array<{ start: number; end: number }>;
}

/**
 * Generate a QR code as a PNG buffer.
 */
export async function generateQRCode(url: string, size = 40): Promise<Buffer> {
  const buffer = await QRCode.toBuffer(url, {
    width: size,
    margin: 0,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
  return buffer;
}

/**
 * Draw a table on the PDF document.
 * Returns the Y position after the table.
 */
export function drawTable(
  doc: InstanceType<typeof PDFDocument>,
  options: TableOptions
): number {
  const {
    columns,
    rows,
    x = 40,
    headerBg = "#d3d3d3",
    headerColor = "#000000",
    rowHeight = 25,
    fontSize = 8,
    highlightRows,
    highlightColor = "#FFFF00",
    boxGroups,
  } = options;

  let startY = options.y ?? doc.y;
  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);

  // Helper to check if we need a new page
  const checkPage = (neededHeight: number) => {
    if (startY + neededHeight > doc.page.height - 40) {
      doc.addPage();
      startY = 40;
    }
  };

  // Draw header
  checkPage(rowHeight);
  doc.rect(x, startY, totalWidth, rowHeight).fill(headerBg);

  let colX = x;
  doc.font("Helvetica-Bold").fontSize(fontSize).fillColor(headerColor);
  for (const col of columns) {
    doc.text(col.header, colX + 3, startY + 5, {
      width: col.width - 6,
      height: rowHeight - 6,
      lineBreak: false,
    });
    colX += col.width;
  }

  // Draw header grid
  doc.strokeColor("#cccccc").lineWidth(0.25);
  colX = x;
  for (const col of columns) {
    doc.rect(colX, startY, col.width, rowHeight).stroke();
    colX += col.width;
  }

  startY += rowHeight;

  // Draw rows
  doc.font("Helvetica").fontSize(fontSize).fillColor("#000000");
  const rowPositions: Array<{ y: number; height: number }> = [];

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx]!;

    // Calculate row height based on content
    let maxLineCount = 1;
    for (const col of columns) {
      const cellText = String(row[col.key] ?? "");
      const lines = cellText.split("\n");
      maxLineCount = Math.max(maxLineCount, lines.length);
    }
    const actualRowHeight = Math.max(rowHeight, maxLineCount * (fontSize + 4) + 8);

    checkPage(actualRowHeight);

    // Highlight row if needed
    if (highlightRows?.has(rowIdx)) {
      doc.rect(x, startY, totalWidth, actualRowHeight).fill(highlightColor);
    }

    // Draw cell contents
    colX = x;
    doc.fillColor("#000000");
    for (const col of columns) {
      const cellText = String(row[col.key] ?? "");
      doc.text(cellText, colX + 3, startY + 4, {
        width: col.width - 6,
        height: actualRowHeight - 4,
        lineBreak: true,
      });
      colX += col.width;
    }

    // Draw cell borders
    colX = x;
    doc.strokeColor("#cccccc").lineWidth(0.25);
    for (const col of columns) {
      doc.rect(colX, startY, col.width, actualRowHeight).stroke();
      colX += col.width;
    }

    rowPositions.push({ y: startY, height: actualRowHeight });
    startY += actualRowHeight;
  }

  // Draw box groups (for duplicate NF grouping)
  if (boxGroups) {
    doc.strokeColor("#000000").lineWidth(2);
    for (const group of boxGroups) {
      const firstRow = rowPositions[group.start];
      const lastRow = rowPositions[group.end];
      if (firstRow && lastRow) {
        const groupY = firstRow.y;
        const groupH = lastRow.y + lastRow.height - groupY;
        doc.rect(x, groupY, totalWidth, groupH).stroke();
      }
    }
    doc.strokeColor("#cccccc").lineWidth(0.25);
  }

  return startY;
}

/**
 * Draw a summary table (model/mold counts).
 */
export function drawSummaryTable(
  doc: InstanceType<typeof PDFDocument>,
  title: string,
  counts: Map<string, number>,
  labelHeader: string,
  x = 40,
  y?: number
): number {
  const startY = y ?? doc.y;
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#000000");
  doc.text(title, x, startY);
  doc.moveDown(0.3);

  const rows: Record<string, string | number>[] = [];
  counts.forEach((value, key) => {
    rows.push({ label: key, qty: value });
  });

  return drawTable(doc, {
    columns: [
      { header: labelHeader, key: "label", width: 300 },
      { header: "Quantidade", key: "qty", width: 60 },
    ],
    rows,
    x,
    y: doc.y,
  });
}

/**
 * Create a new PDF document as a buffer.
 */
export function createPdfDocument(): InstanceType<typeof PDFDocument> {
  return new PDFDocument({
    size: "LETTER",
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
  });
}

/**
 * Finalize PDF document and return as Buffer.
 */
export function finalizePdf(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

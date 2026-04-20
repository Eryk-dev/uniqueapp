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
  /** Map of "rowIndex:colKey" → image Buffer to render in that cell instead of text. */
  cellImages?: Map<string, Buffer>;
  /** Size (width & height) for cell images. Default 30. */
  cellImageSize?: number;
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
    cellImages,
    cellImageSize = 30,
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

  // Build lookup: row index → box group
  const rowGroupMap = new Map<number, { start: number; end: number }>();
  if (boxGroups) {
    for (const group of boxGroups) {
      for (let r = group.start; r <= group.end; r++) {
        rowGroupMap.set(r, group);
      }
    }
  }

  // Draw rows
  doc.font("Helvetica").fontSize(fontSize).fillColor("#000000");
  let boxGroupStartY: number | null = null;

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx]!;

    // Calculate row height based on content
    let maxLineCount = 1;
    let hasImage = false;
    for (const col of columns) {
      const imgKey = `${rowIdx}:${col.key}`;
      if (cellImages?.has(imgKey)) {
        hasImage = true;
      } else {
        const cellText = String(row[col.key] ?? "");
        const lines = cellText.split("\n");
        maxLineCount = Math.max(maxLineCount, lines.length);
      }
    }
    const textHeight = maxLineCount * (fontSize + 4) + 8;
    const imageHeight = hasImage ? cellImageSize + 8 : 0;
    const actualRowHeight = Math.max(rowHeight, textHeight, imageHeight);

    // If page will break and we have an open box group, close it at the bottom of this page
    const willBreakPage = startY + actualRowHeight > doc.page.height - 40;
    if (willBreakPage && boxGroupStartY !== null) {
      doc.strokeColor("#000000").lineWidth(2);
      doc.rect(x, boxGroupStartY, totalWidth, startY - boxGroupStartY).stroke();
      doc.strokeColor("#cccccc").lineWidth(0.25);
      boxGroupStartY = null;
    }

    checkPage(actualRowHeight);

    // If we're in a box group and need to start/continue tracking
    const currentGroup = rowGroupMap.get(rowIdx) ?? null;
    if (currentGroup && boxGroupStartY === null) {
      boxGroupStartY = startY;
    }

    // Highlight row if needed
    if (highlightRows?.has(rowIdx)) {
      doc.rect(x, startY, totalWidth, actualRowHeight).fill(highlightColor);
    }

    // Draw cell contents
    colX = x;
    doc.fillColor("#000000");
    for (const col of columns) {
      const imgKey = `${rowIdx}:${col.key}`;
      const imgBuf = cellImages?.get(imgKey);
      if (imgBuf) {
        doc.image(imgBuf, colX + 3, startY + 3, {
          width: cellImageSize,
          height: cellImageSize,
        });
      } else {
        const cellText = String(row[col.key] ?? "");
        doc.text(cellText, colX + 3, startY + 4, {
          width: col.width - 6,
          height: actualRowHeight - 4,
          lineBreak: true,
        });
      }
      colX += col.width;
    }

    // Draw cell borders
    colX = x;
    doc.strokeColor("#cccccc").lineWidth(0.25);
    for (const col of columns) {
      doc.rect(colX, startY, col.width, actualRowHeight).stroke();
      colX += col.width;
    }

    startY += actualRowHeight;

    // If this is the last row of the box group, draw the border
    if (currentGroup && rowIdx === currentGroup.end && boxGroupStartY !== null) {
      doc.strokeColor("#000000").lineWidth(2);
      doc.rect(x, boxGroupStartY, totalWidth, startY - boxGroupStartY).stroke();
      doc.strokeColor("#cccccc").lineWidth(0.25);
      boxGroupStartY = null;
    }

    // If we left a group without being the end (shouldn't happen with sorted data), reset
    if (!currentGroup) {
      boxGroupStartY = null;
    }
  }

  // Sync PDFKit internal cursor so moveDown() works after drawTable
  doc.y = startY;
  doc.x = x;

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

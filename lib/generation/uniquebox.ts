/**
 * UniqueBox SVG + PDF generation.
 * Ported from Python api_unique/uniquebox/core.py
 */
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { UNIQUEBOX_CONFIG } from "./config";
import {
  findMaxFontSize,
  insertTextSvgFlipped,
  parseSvg,
  serializeSvg,
  applyColorToAllPaths,
} from "./svg-engine";
import {
  createPdfDocument,
  finalizePdf,
  drawTable,
  drawSummaryTable,
  generateQRCode,
} from "./pdf-engine";

// Heart emoji list for conversion
const HEART_EMOJIS = [
  "❤️", "❤", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "🩷", "🩵", "🩶",
  "💗", "💖", "💝", "💘", "💕", "💞", "💓", "💔", "❣️", "❣", "💟", "💌",
  "❤️‍🔥", "❤‍🔥", "❤️‍🩹", "❤‍🩹",
  "😍", "🥰", "😘", "🫶", "🫶🏻", "🫶🏼", "🫶🏽", "🫶🏾", "🫶🏿", "🫀",
  "♡", "♥️", "♥︎", "❥", "❦", "❧", "☙", "❤︎",
  "ღ", "ლ",
];

export interface UniqueBoxMessage {
  mensagem: string;
  cliente?: string;
  modelo?: string;
  notaFiscal?: string | number;
  formaEnvio?: string;
  pedidoId?: string | number;
  idNF?: number;
  idFormaFrete?: number;
  _item_id?: string;
  _pedido_id?: string;
}

/**
 * Check if a message has personalization (LineX: prefix).
 */
export function hasPersonalization(mensagem: string): boolean {
  if (!mensagem) return false;
  if (mensagem.trim().toLowerCase().startsWith("upload")) return false;
  return new RegExp("Line\\d+:", "i").test(mensagem);
}

/**
 * Format message for UniqueBox plate:
 * - Convert heart emojis to ♥
 * - Extract from Line1: onwards
 * - Remove LineX: prefixes
 * - Convert to uppercase
 */
export function formatPlateMessage(mensagem: string): string {
  if (!mensagem) return "";

  let msg = mensagem;
  for (const emoji of HEART_EMOJIS) {
    msg = msg.replaceAll(emoji, "♥");
  }

  const match = msg.match(new RegExp("Line1:.*", "is"));
  if (match) {
    msg = match[0];
  }

  msg = msg.replace(new RegExp("Line\\d+:\\s*", "gi"), "");
  const parts = msg
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const formatted = parts.length > 1 ? parts.join("\n") : (parts[0] ?? "");
  return formatted.toUpperCase();
}

interface CsvCoordinate {
  superior_esquerdo_x: number;
  inferior_esquerdo_y: number;
  superior_direito_x: number;
  superior_esquerdo_y: number;
}

/**
 * Load coordinate data from CSV.
 */
function loadCoordinates(): CsvCoordinate[] {
  const content = fs.readFileSync(UNIQUEBOX_CONFIG.CSV_PATH, "utf-8");
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  return records.map((r) => ({
    superior_esquerdo_x: parseFloat(r["superior_esquerdo_x"]!),
    inferior_esquerdo_y: parseFloat(r["inferior_esquerdo_y"]!),
    superior_direito_x: parseFloat(r["superior_direito_x"]!),
    superior_esquerdo_y: parseFloat(r["superior_esquerdo_y"]!),
  }));
}

/**
 * Find the SVG template path based on the number of personalized messages.
 */
function findTemplatePath(numMessages: number): string {
  const templateName = `molde_${numMessages}.svg`;
  const templatePath = path.join(UNIQUEBOX_CONFIG.TEMPLATES_DIR, templateName);
  if (fs.existsSync(templatePath)) return templatePath;
  // Fallback to 28
  const fallback = path.join(UNIQUEBOX_CONFIG.TEMPLATES_DIR, "molde_28.svg");
  if (fs.existsSync(fallback)) return fallback;
  throw new Error(`Template not found: ${templateName}`);
}

/**
 * Gera UniqueBox SVGs em chunks de até 28 mensagens.
 * Retorna array com 1+ SVGs (um por chapa). Vazio se nao houver mensagens
 * personalizadas.
 */
export function generateUniqueBoxSvgs(
  messages: UniqueBoxMessage[]
): string[] {
  const personalizadas = messages.filter((m) => hasPersonalization(m.mensagem));
  if (personalizadas.length === 0) return [];

  const chunks: UniqueBoxMessage[][] = [];
  for (let i = 0; i < personalizadas.length; i += 28) {
    chunks.push(personalizadas.slice(i, i + 28));
  }

  const svgs: string[] = [];
  for (const c of chunks) {
    const svg = generateUniqueBoxSvg(c);
    if (svg) svgs.push(svg);
  }
  return svgs;
}

/**
 * Generate UniqueBox SVG with personalized text.
 * Returns the SVG content as a string, or null if no personalized messages.
 */
export function generateUniqueBoxSvg(
  messages: UniqueBoxMessage[]
): string | null {
  const personalizedMsgs = messages.filter((m) =>
    hasPersonalization(m.mensagem)
  );
  const numPersonalized = personalizedMsgs.length;

  if (numPersonalized === 0) return null;

  const effectiveCount = Math.min(numPersonalized, 28);
  const templatePath = findTemplatePath(effectiveCount);
  const doc = parseSvg(templatePath);
  const root = doc.documentElement;

  // Apply blue color to all existing paths
  applyColorToAllPaths(doc, UNIQUEBOX_CONFIG.COR_FILL);

  // Create text layer
  const textLayer = doc.createElementNS("http://www.w3.org/2000/svg", "g");
  textLayer.setAttribute("id", "Camada_de_Texto");
  root.insertBefore(textLayer, root.firstChild);

  // Load coordinates
  const coordinates = loadCoordinates();

  // Insert text for each personalized message
  for (let idx = 0; idx < personalizedMsgs.length && idx < coordinates.length; idx++) {
    const coord = coordinates[idx]!;
    const msg = personalizedMsgs[idx]!;

    const x0 = coord.superior_esquerdo_x + UNIQUEBOX_CONFIG.MARGEM_HORIZONTAL;
    const y0 = coord.inferior_esquerdo_y + UNIQUEBOX_CONFIG.MARGEM_VERTICAL;
    const x1 = coord.superior_direito_x - UNIQUEBOX_CONFIG.MARGEM_HORIZONTAL;
    const y1 = coord.superior_esquerdo_y - UNIQUEBOX_CONFIG.MARGEM_VERTICAL;

    const formatted = formatPlateMessage(msg.mensagem);
    if (!formatted) continue;

    const boxW = x1 - x0;
    const boxH = y1 - y0;
    const fontSize = findMaxFontSize(
      formatted,
      boxW,
      boxH,
      UNIQUEBOX_CONFIG.FONT_PATH,
      UNIQUEBOX_CONFIG.ESPACAMENTO_ENTRE_LINHAS
    );

    insertTextSvgFlipped(
      doc,
      textLayer,
      x0,
      y0,
      x1,
      y1,
      formatted,
      fontSize,
      UNIQUEBOX_CONFIG.FONT_PATH,
      UNIQUEBOX_CONFIG.COR_FILL,
      UNIQUEBOX_CONFIG.ESPACAMENTO_ENTRE_LINHAS
    );
  }

  return serializeSvg(doc);
}

/**
 * Generate UniqueBox conference PDF.
 * Returns the PDF as a Buffer.
 */
export async function generateUniqueBoxPdf(
  messages: UniqueBoxMessage[],
  /**
   * Map pedido_id (interno do app) -> nomes dos kits do pedido.
   * Pedidos listados ganham 1 row "KIT" antes da primeira ocorrencia + fundo
   * rosa em todas as rows do pedido.
   */
  pedidoKits?: Map<string, string[]>
): Promise<Buffer> {
  const doc = createPdfDocument();

  // Title
  doc.font("Roboto-Bold").fontSize(14).text("Chapa Única - Conferência", { align: "center" });
  doc.moveDown(0.5);

  // Sort: personalized first
  const sorted = [...messages].sort((a, b) => {
    const aP = hasPersonalization(a.mensagem) ? 0 : 1;
    const bP = hasPersonalization(b.mensagem) ? 0 : 1;
    return aP - bP;
  });

  // Find duplicate NFs (info "mesmo pedido com varias mensagens")
  const nfCounts = new Map<string, number>();
  for (const msg of sorted) {
    const nf = String(msg.notaFiscal ?? "");
    if (nf) nfCounts.set(nf, (nfCounts.get(nf) ?? 0) + 1);
  }

  // Build rows + QR + highlights (kit em rosa, dup-NF em amarelo; kit prevalece)
  const rows: Record<string, string | number>[] = [];
  const cellImages = new Map<string, Buffer>();
  const rowColors = new Map<number, string>();
  const KIT_COLOR = "#ffe0ec";
  const DUP_COLOR = "#FFFF00";
  const pedidosComKitInjetada = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    const msg = sorted[i]!;
    const formatted = formatPlateMessage(msg.mensagem).replace(/\n/g, " | ");
    const formaEnvio = msg.formaEnvio ?? "";
    const pedidoTinyId = msg.pedidoId ?? "";
    const pedidoIdInterno = msg._pedido_id ?? "";
    const kits = pedidoIdInterno ? pedidoKits?.get(pedidoIdInterno) ?? [] : [];
    const hasKit = kits.length > 0;

    // Injeta 1 row "KIT" por kit antes da primeira aparicao do pedido
    if (hasKit && pedidoIdInterno && !pedidosComKitInjetada.has(pedidoIdInterno)) {
      pedidosComKitInjetada.add(pedidoIdInterno);
      for (const kitNome of kits) {
        const kitIdx = rows.length;
        rows.push({
          num: rows.length + 1,
          cliente: msg.cliente ?? "",
          modelo: "KIT",
          mensagem: kitNome,
          notaFiscal: msg.notaFiscal ?? "",
          formaFrete: formaEnvio,
          qr: "",
        });
        rowColors.set(kitIdx, KIT_COLOR);
      }
    }

    const rowIdx = rows.length;
    rows.push({
      num: rowIdx + 1,
      cliente: msg.cliente ?? "",
      modelo: msg.modelo ?? "",
      mensagem: formatted,
      notaFiscal: msg.notaFiscal ?? "",
      formaFrete: formaEnvio,
      qr: "",
    });

    if (hasKit) {
      rowColors.set(rowIdx, KIT_COLOR);
    } else {
      const nf = String(msg.notaFiscal ?? "");
      if (nf && (nfCounts.get(nf) ?? 0) > 1) rowColors.set(rowIdx, DUP_COLOR);
    }

    if (pedidoTinyId) {
      const url = formaEnvio.trim().toLowerCase() === "retirada"
        ? `https://erp.tiny.com.br/retirada#edit/${pedidoTinyId}`
        : `https://erp.tiny.com.br/vendas#edit/${pedidoTinyId}`;
      const qrBuf = await generateQRCode(url, 30);
      cellImages.set(`${rowIdx}:qr`, qrBuf);
    }
  }

  // Main table
  drawTable(doc, {
    columns: [
      { header: "#", key: "num", width: 25 },
      { header: "Cliente", key: "cliente", width: 80 },
      { header: "Modelo", key: "modelo", width: 80 },
      { header: "Mensagem", key: "mensagem", width: 160 },
      { header: "Nota Fiscal", key: "notaFiscal", width: 60 },
      { header: "Forma Frete", key: "formaFrete", width: 60 },
      { header: "QR Pedido", key: "qr", width: 60 },
    ],
    rows,
    rowColors,
    cellImages,
  });

  doc.moveDown(1);

  // Model summary
  const modelCounts = new Map<string, number>();
  for (const msg of sorted) {
    const modelo = msg.modelo ?? "";
    modelCounts.set(modelo, (modelCounts.get(modelo) ?? 0) + 1);
  }
  drawSummaryTable(doc, "Resumo de Modelos", modelCounts, "Modelo");

  return finalizePdf(doc);
}

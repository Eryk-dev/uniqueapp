/**
 * UniqueKids SVG + PDF generation.
 * Ported from Python api_unique/uniquekids/core.py
 */
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { UNIQUEKIDS_CONFIG, type FontConfig } from "./config";
import {
  insertMultiTextSvg,
  parseSvg,
  serializeSvg,
} from "./svg-engine";
import {
  createPdfDocument,
  finalizePdf,
  drawTable,
  drawSummaryTable,
} from "./pdf-engine";

export interface UniqueKidsOrder {
  "ID NF"?: number | string;
  "Numero NF"?: number | string;
  Molde: string;
  Fonte: string;
  "NOME (PERSONAL)": string;
  Modelo: string;
  "Forma frete"?: string;
  "Nome Cliente"?: string;
  "ID pedido"?: string | number;
  idFormaFrete?: number;
  _item_id?: string;
  _pedido_id?: string;
}

interface CoordinateRow {
  Molde: string;
  centro_x: number;
  centro_y: number;
  largura_pt: number;
  altura_pt: number;
  orientacao: string;
}

/**
 * Format name for UniqueKids mold.
 */
export function formatMoldName(name: string, font = ""): string {
  const cleaned = name.replace(/^Nome:\s*/i, "").trim();
  return font.toUpperCase() === "TD" ? toTitleCase(cleaned) : cleaned.toUpperCase();
}

function toTitleCase(str: string): string {
  return str.replace(/\w\S*/g, (txt) =>
    txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase()
  );
}

/**
 * Expand order with multiple names (Nome1:, Nome2:) into separate orders.
 */
export function expandNames(order: UniqueKidsOrder): UniqueKidsOrder[] {
  const nameField = order["NOME (PERSONAL)"];
  if (typeof nameField === "string" && nameField.includes("Nome:")) {
    const names = Array.from(nameField.matchAll(new RegExp("Nome\\d*:\\s*([^,]+)", "g"))).map((m) => m[1]!.trim());
    if (names.length > 1) {
      return names.map((n) => ({ ...order, "NOME (PERSONAL)": n }));
    }
  }
  return [order];
}

/**
 * Load and filter coordinates from CSV for a specific mold.
 */
function loadCoordinates(baseMold: string): CoordinateRow[] {
  const content = fs.readFileSync(UNIQUEKIDS_CONFIG.CSV_COORDENADAS, "utf-8");
  const records = parse(content, {
    delimiter: ";",
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  return records
    .map((r) => ({
      Molde: (r["Molde"] ?? "").trim(),
      centro_x: parseFloat((r["centro_x"] ?? "0").replace(",", ".")),
      centro_y: parseFloat((r["centro_y"] ?? "0").replace(",", ".")),
      largura_pt: parseFloat((r["largura_pt"] ?? "0").replace(",", ".")),
      altura_pt: parseFloat((r["altura_pt"] ?? "0").replace(",", ".")),
      orientacao: (r["orientacao"] ?? "").trim().toUpperCase(),
    }))
    .filter((r) => r.Molde === baseMold);
}

/**
 * Get font config by name.
 */
function getFontConfig(fontName: string): FontConfig | null {
  const key = fontName.toUpperCase();
  return (UNIQUEKIDS_CONFIG.FONTES as Record<string, FontConfig>)[key] ?? null;
}

/**
 * Generate SVG files for a group of orders with the same mold.
 * Returns array of SVG content strings.
 */
export function generateMoldSvgs(
  orders: UniqueKidsOrder[]
): Array<{ content: string; filename: string }> {
  if (!orders.length) return [];

  const baseMold = (orders[0]!.Molde ?? "").trim();
  const defaultFont = (orders[0]!.Fonte ?? "MALINDA").toUpperCase();

  // PD mold: no SVG generated
  if (baseMold === "PD" || defaultFont === "PD") return [];

  const coords = loadCoordinates(baseMold);
  if (!coords.length) {
    throw new Error(`No coordinates defined for mold '${baseMold}' in CSV.`);
  }

  const isNmAv = baseMold === "NM AV";
  const capacityInNames = isNmAv ? Math.floor(coords.length / 2) : coords.length;

  // Split orders into chunks
  const chunks: UniqueKidsOrder[][] = [];
  for (let i = 0; i < orders.length; i += capacityInNames) {
    chunks.push(orders.slice(i, i + capacityInNames));
  }

  const results: Array<{ content: string; filename: string }> = [];

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const group = chunks[chunkIdx]!;
    const n = group.length;

    // Find template
    const templateFilename = `${baseMold}_${n}.svg`;
    let templatePath = path.join(UNIQUEKIDS_CONFIG.SVG_TEMPLATE_DIR, templateFilename);
    if (!fs.existsSync(templatePath)) {
      templatePath = UNIQUEKIDS_CONFIG.DEFAULT_SVG_TEMPLATE;
    }

    const coordsForGroup = isNmAv ? coords.slice(0, 2 * n) : coords.slice(0, n);
    const doc = parseSvg(templatePath);
    const root = doc.documentElement;

    // Create text layer
    const textLayer = doc.createElementNS("http://www.w3.org/2000/svg", "g");
    textLayer.setAttribute("id", "Camada_de_Texto");
    root.insertBefore(textLayer, root.firstChild);

    // Process each order
    for (let i = 0; i < group.length; i++) {
      const order = group[i]!;
      const nameRaw = order["NOME (PERSONAL)"] ?? "";
      const orderFont = (order.Fonte ?? defaultFont).toUpperCase();
      const fontConfig = getFontConfig(orderFont);
      if (!fontConfig) continue;

      // Build text components
      const components = buildTextComponents(baseMold, nameRaw, orderFont, fontConfig);

      if (isNmAv) {
        // Special NM AV handling: text + box coordinates
        const coordText = coordsForGroup[2 * i]!;
        const coordBox = coordsForGroup[2 * i + 1]!;

        // Text coordinates
        const x0t = coordText.centro_x - coordText.largura_pt / 2;
        const x1t = coordText.centro_x + coordText.largura_pt / 2;
        const y0t = coordText.centro_y - coordText.altura_pt / 2;
        const y1t = coordText.centro_y + coordText.altura_pt / 2;

        let rectInfo: { x: number; y: number; width: number; height: number } | undefined;

        if (coordText.orientacao === "VERTICAL") {
          const groupElem = doc.createElementNS("http://www.w3.org/2000/svg", "g");
          groupElem.setAttribute(
            "transform",
            `translate(${coordText.centro_x},${coordText.centro_y}) rotate(90)`
          );
          rectInfo = insertMultiTextSvg(
            doc,
            groupElem,
            -coordText.largura_pt / 2,
            -coordText.altura_pt / 2,
            coordText.largura_pt / 2,
            coordText.altura_pt / 2,
            components,
            true,
            40,
            undefined,
            undefined,
            UNIQUEKIDS_CONFIG.LINE_SPACING_ADJUST
          );
          textLayer.appendChild(groupElem);
        } else {
          rectInfo = insertMultiTextSvg(
            doc,
            textLayer,
            x0t,
            y0t,
            x1t,
            y1t,
            components,
            true,
            40,
            undefined,
            undefined,
            UNIQUEKIDS_CONFIG.LINE_SPACING_ADJUST
          );
        }

        // Box coordinates
        const x0b = coordBox.centro_x - coordBox.largura_pt / 2;
        const x1b = coordBox.centro_x + coordBox.largura_pt / 2;
        const y0b = coordBox.centro_y - coordBox.altura_pt / 2;
        const y1b = coordBox.centro_y + coordBox.altura_pt / 2;

        const emptyComp = [{ text: "", fontPath: fontConfig.path, fontSize: fontConfig.size, trackingOffset: fontConfig.trackingOffset }];

        if (coordBox.orientacao === "VERTICAL") {
          const groupElemBox = doc.createElementNS("http://www.w3.org/2000/svg", "g");
          groupElemBox.setAttribute(
            "transform",
            `translate(${coordBox.centro_x},${coordBox.centro_y}) rotate(90)`
          );
          insertMultiTextSvg(
            doc,
            groupElemBox,
            -coordBox.largura_pt / 2,
            -coordBox.altura_pt / 2,
            coordBox.largura_pt / 2,
            coordBox.altura_pt / 2,
            emptyComp,
            true,
            40,
            undefined,
            rectInfo,
            UNIQUEKIDS_CONFIG.LINE_SPACING_ADJUST
          );
          textLayer.appendChild(groupElemBox);
        } else {
          insertMultiTextSvg(
            doc,
            textLayer,
            x0b,
            y0b,
            x1b,
            y1b,
            emptyComp,
            true,
            40,
            undefined,
            rectInfo,
            UNIQUEKIDS_CONFIG.LINE_SPACING_ADJUST
          );
        }
      } else {
        // Standard mold processing
        const coord = coordsForGroup[i]!;
        const x0 = coord.centro_x - coord.largura_pt / 2;
        const x1 = coord.centro_x + coord.largura_pt / 2;
        const y0 = coord.centro_y - coord.altura_pt / 2;
        const y1 = coord.centro_y + coord.altura_pt / 2;

        if (coord.orientacao === "VERTICAL") {
          const groupElem = doc.createElementNS("http://www.w3.org/2000/svg", "g");
          groupElem.setAttribute(
            "transform",
            `translate(${coord.centro_x},${coord.centro_y}) rotate(90)`
          );
          insertMultiTextSvg(
            doc,
            groupElem,
            -coord.largura_pt / 2,
            -coord.altura_pt / 2,
            coord.largura_pt / 2,
            coord.altura_pt / 2,
            components,
            false,
            40,
            undefined,
            undefined,
            UNIQUEKIDS_CONFIG.LINE_SPACING_ADJUST
          );
          textLayer.appendChild(groupElem);
        } else {
          insertMultiTextSvg(
            doc,
            textLayer,
            x0,
            y0,
            x1,
            y1,
            components,
            false,
            40,
            undefined,
            undefined,
            UNIQUEKIDS_CONFIG.LINE_SPACING_ADJUST
          );
        }
      }
    }

    // Build filename
    const nfIds = group
      .map((p) => String(p["ID NF"] ?? ""))
      .filter(Boolean);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
    const filename = nfIds.length
      ? `${baseMold}_NF${nfIds[0]}_${timestamp}.svg`
      : `${baseMold}_${timestamp}_${chunkIdx}.svg`;

    results.push({ content: serializeSvg(doc), filename });
  }

  return results;
}

/**
 * Build text components for a given mold type and name.
 */
function buildTextComponents(
  baseMold: string,
  nameRaw: string,
  fontName: string,
  fontConfig: FontConfig
): Array<{ text: string; fontPath: string; fontSize: number; trackingOffset: number }> {
  const isTd = fontName === "TD";
  const isCompound = ["NM AV CP", "NNA CP"].includes(baseMold);

  if (isCompound) {
    const cleaned = nameRaw.replace(/^Nome:\s*/i, "").trim();
    const formatted = isTd ? toTitleCase(cleaned) : cleaned.toUpperCase();
    const parts = formatted.split(" ", 2);
    if (parts.length === 2) {
      return parts.map((p) => ({
        text: p,
        fontPath: fontConfig.path,
        fontSize: fontConfig.size,
        trackingOffset: fontConfig.trackingOffset,
      }));
    }
    return [{
      text: formatted,
      fontPath: fontConfig.path,
      fontSize: fontConfig.size,
      trackingOffset: fontConfig.trackingOffset,
    }];
  }

  // Check for multiple names
  if (typeof nameRaw === "string" && nameRaw.includes("Nome:")) {
    const names = Array.from(nameRaw.matchAll(new RegExp("Nome\\d*:\\s*([^,]+)", "g")))
      .map((m) => m[1]!.trim())
      .map((n) => (isTd ? toTitleCase(n) : n.toUpperCase()));
    return names.map((n) => ({
      text: n,
      fontPath: fontConfig.path,
      fontSize: fontConfig.size,
      trackingOffset: fontConfig.trackingOffset,
    }));
  }

  const text = isTd ? toTitleCase(nameRaw.trim()) : nameRaw.trim().toUpperCase();
  return [{
    text,
    fontPath: fontConfig.path,
    fontSize: fontConfig.size,
    trackingOffset: fontConfig.trackingOffset,
  }];
}

/**
 * Generate conference PDF for UniqueKids orders.
 */
export async function generateUniqueKidsPdf(
  orders: UniqueKidsOrder[]
): Promise<Buffer> {
  // Sort by ID NF
  const sorted = [...orders].sort(
    (a, b) => String(a["ID NF"] ?? "").localeCompare(String(b["ID NF"] ?? ""))
  );

  const doc = createPdfDocument();

  // Title
  doc.font("Helvetica-Bold").fontSize(14).text("Folha de Conferência", { align: "center" });
  doc.moveDown(0.5);

  // Find duplicate NFs for box grouping
  const nfCounts = new Map<string, number>();
  for (const order of sorted) {
    const nf = String(order["ID NF"] ?? "");
    if (nf) nfCounts.set(nf, (nfCounts.get(nf) ?? 0) + 1);
  }

  // Build box groups (contiguous rows with same duplicate NF)
  const boxGroups: Array<{ start: number; end: number }> = [];
  let groupStart = 0;
  for (let i = 1; i <= sorted.length; i++) {
    const prevNf = String(sorted[i - 1]?.["ID NF"] ?? "");
    const currNf = i < sorted.length ? String(sorted[i]?.["ID NF"] ?? "") : null;
    if (currNf !== prevNf) {
      if (prevNf && (nfCounts.get(prevNf) ?? 0) > 1) {
        boxGroups.push({ start: groupStart, end: i - 1 });
      }
      groupStart = i;
    }
  }

  // Build rows
  const rows: Record<string, string | number>[] = sorted.map((order, i) => ({
    num: i + 1,
    nomeCliente: order["Nome Cliente"] ?? "",
    molde: order.Molde ?? "",
    modelo: order.Modelo ?? "",
    nomePersonal: (order["NOME (PERSONAL)"] ?? "").trim(),
    idNf: order["ID NF"] ?? "",
    numeroNf: order["Numero NF"] ?? "",
    formaFrete: order["Forma frete"] ?? "",
    idPedido: order["ID pedido"] ?? "",
  }));

  // Main table
  drawTable(doc, {
    columns: [
      { header: "#", key: "num", width: 22 },
      { header: "Nome Cliente", key: "nomeCliente", width: 70 },
      { header: "Molde", key: "molde", width: 50 },
      { header: "Modelo", key: "modelo", width: 55 },
      { header: "NOME (PERSONAL)", key: "nomePersonal", width: 90 },
      { header: "ID NF", key: "idNf", width: 50 },
      { header: "Nº NF", key: "numeroNf", width: 45 },
      { header: "Frete", key: "formaFrete", width: 55 },
      { header: "ID Pedido", key: "idPedido", width: 55 },
    ],
    rows,
    boxGroups,
  });

  doc.moveDown(1);

  // Model summary
  const modelCounts = new Map<string, number>();
  for (const order of sorted) {
    const m = order.Modelo ?? "";
    modelCounts.set(m, (modelCounts.get(m) ?? 0) + 1);
  }
  drawSummaryTable(doc, "Resumo de Modelos", modelCounts, "Modelo");
  doc.moveDown(0.5);

  // Mold summary
  const moldCounts = new Map<string, number>();
  for (const order of sorted) {
    const m = order.Molde ?? "";
    moldCounts.set(m, (moldCounts.get(m) ?? 0) + 1);
  }
  drawSummaryTable(doc, "Resumo de Moldes", moldCounts, "Molde");
  doc.moveDown(0.5);

  // PD products summary
  const pdOrders = sorted.filter((o) => (o.Molde ?? "").trim().toUpperCase() === "PD");
  if (pdOrders.length > 0) {
    const pdModelCounts = new Map<string, number>();
    for (const order of pdOrders) {
      const m = order.Modelo ?? "";
      pdModelCounts.set(m, (pdModelCounts.get(m) ?? 0) + 1);
    }
    drawSummaryTable(doc, "Produtos sem personalização", pdModelCounts, "Modelo");
  }

  return finalizePdf(doc);
}

/**
 * Generate colored letter items for PD orders.
 */
export function generateColoredLetterItems(
  order: UniqueKidsOrder
): Array<{ produto: { id: string }; quantidade: number; valorUnitario: number }> {
  const font = (order.Fonte ?? "").toUpperCase();
  if (!font || font === "TD") return [];

  const nameField = (order["NOME (PERSONAL)"] ?? "").trim();
  if (!nameField) return [];

  const productMap: Record<string, string> = JSON.parse(
    fs.readFileSync(UNIQUEKIDS_CONFIG.PRODUCT_MAP, "utf-8")
  );

  // Extract names
  const nameMatches = Array.from(nameField.matchAll(new RegExp("Nome\\d*:\\s*([^,]+)", "g")));
  const names = nameMatches.length
    ? nameMatches.map((m) => m[1]!.trim())
    : [nameField];

  const items: Array<{ produto: { id: string }; quantidade: number; valorUnitario: number }> = [];

  for (const name of names) {
    const cleaned = name.replace(/[^A-Za-z]/g, "").toUpperCase();
    if (!cleaned) continue;

    for (let idx = 0; idx < cleaned.length; idx++) {
      const letter = cleaned[idx]!;
      const color = UNIQUEKIDS_CONFIG.RAINBOW[idx % UNIQUEKIDS_CONFIG.RAINBOW.length]!;
      const key = `${letter}-${color}-${font}`.toUpperCase();
      const productId = productMap[key];
      if (!productId) {
        throw new Error(`Unmapped combination: ${key}`);
      }
      items.push({ produto: { id: productId }, quantidade: 1, valorUnitario: 0.1 });
    }
  }

  return items;
}

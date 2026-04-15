/**
 * SVG text rendering engine using opentype.js for font glyph extraction.
 * Replaces Python fontTools-based rendering from the Flask API.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const opentype = require("opentype.js");
import fs from "fs";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Font cache to avoid reloading
const fontCache = new Map<string, any>();

export function loadFont(fontPath: string): any {
  const cached = fontCache.get(fontPath);
  if (cached) return cached;
  const buffer = fs.readFileSync(fontPath);
  const font = opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  fontCache.set(fontPath, font);
  return font;
}

export interface TextMetrics {
  width: number;
  height: number;
  lineHeight: number;
}

/**
 * Measure text dimensions at a given font size.
 */
export function measureText(
  text: string,
  fontSize: number,
  fontPath: string,
  lineSpacing = 1.0
): TextMetrics {
  const font = loadFont(fontPath);
  const scale = fontSize / font.unitsPerEm;
  const ascent = (font.tables?.os2?.sTypoAscender ?? font.ascender) * scale;
  const descent = Math.abs((font.tables?.os2?.sTypoDescender ?? font.descender) * scale);
  const lineHeight = (ascent + descent) * lineSpacing;

  const lines = text.split("\n");
  let maxWidth = 0;

  for (const line of lines) {
    let lineWidth = 0;
    for (let ci = 0; ci < line.length; ci++) {
      const glyph = font.charToGlyph(line[ci]);
      if (glyph.index !== 0) {
        lineWidth += (glyph.advanceWidth ?? 0) * scale;
      }
    }
    maxWidth = Math.max(maxWidth, lineWidth);
  }

  const totalHeight = lines.length * lineHeight;
  return { width: maxWidth, height: totalHeight, lineHeight };
}

/**
 * Binary search for the maximum font size that fits within the given box.
 */
export function findMaxFontSize(
  text: string,
  boxWidth: number,
  boxHeight: number,
  fontPath: string,
  lineSpacing = 1.0,
  maxFont = 500,
  minFont = 8
): number {
  let low = minFont;
  let high = maxFont;
  let best = minFont;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const metrics = measureText(text, mid, fontPath, lineSpacing);
    if (metrics.width <= boxWidth && metrics.height <= boxHeight) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

/**
 * Insert text into an SVG document as glyph path outlines (UniqueBox style).
 * Text is horizontally flipped (mirrored) as required for laser cutting plates.
 */
export function insertTextSvgFlipped(
  doc: any,
  parentGroup: any,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  text: string,
  fontSize: number,
  fontPath: string,
  fillColor: string,
  lineSpacing = 1.0
): void {
  const boxW = x1 - x0;
  const boxH = y1 - y0;
  if (!text) return;

  const font = loadFont(fontPath);
  const scale = fontSize / font.unitsPerEm;
  const ascent = (font.tables?.os2?.sTypoAscender ?? font.ascender) * scale;
  const metrics = measureText(text, fontSize, fontPath, lineSpacing);

  let yPos = y0 + (boxH - metrics.height) / 1.9;
  const textBlock = doc.createElementNS("http://www.w3.org/2000/svg", "g");
  textBlock.setAttribute("id", "texto_block");

  const lines = text.split("\n");
  for (const line of lines) {
    // Measure line width
    let lineWidth = 0;
    for (let ci = 0; ci < line.length; ci++) {
      const glyph = font.charToGlyph(line[ci]);
      if (glyph.index !== 0) {
        lineWidth += (glyph.advanceWidth ?? 0) * scale;
      }
    }

    let xPos = x0 + (boxW - lineWidth) / 2;

    for (let ci = 0; ci < line.length; ci++) {
      const glyph = font.charToGlyph(line[ci]);
      if (glyph.index === 0) continue;

      const advance = (glyph.advanceWidth ?? 0) * scale;
      const glyphPath = glyph.getPath(xPos, yPos + ascent, fontSize);
      const svgStr = glyphPath.toSVG(2);
      const match = svgStr.match(/d="([^"]+)"/);
      if (match) {
        const pathEl = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        pathEl.setAttribute("d", match[1]);
        pathEl.setAttribute("fill", fillColor);
        pathEl.setAttribute("style", `fill:${fillColor}`);
        textBlock.appendChild(pathEl);
      }
      xPos += advance;
    }
    yPos += metrics.lineHeight;
  }

  // Create flip group (mirror horizontally for laser cutting)
  const flipGroup = doc.createElementNS("http://www.w3.org/2000/svg", "g");
  flipGroup.setAttribute("id", "texto_flip");
  flipGroup.setAttribute("transform", `translate(${x0 + x1},0) scale(-1,1)`);
  flipGroup.appendChild(textBlock);
  parentGroup.appendChild(flipGroup);
}

export interface RectInfo {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Insert centered text into an SVG (UniqueKids style).
 * Returns rectangle info if isNa is true.
 */
export function insertTextSvgCentered(
  doc: any,
  parentGroup: any,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  text: string,
  fontPath: string,
  fontSize: number,
  trackingOffset: number,
  fillColor = "#0000FF",
  isNa = false,
  margin = 20,
  customHeight?: number,
  rectInfo?: RectInfo
): RectInfo | undefined {
  const boxCenterX = (x0 + x1) / 2;
  const boxCenterY = (y0 + y1) / 2;

  // If isNa and no text, just draw a rectangle
  if (!text && isNa && rectInfo) {
    const rectEl = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
    const rx = boxCenterX - rectInfo.width / 2;
    const ry = boxCenterY - rectInfo.height / 2;
    rectEl.setAttribute("x", String(rx));
    rectEl.setAttribute("y", String(ry));
    rectEl.setAttribute("width", String(rectInfo.width));
    rectEl.setAttribute("height", String(rectInfo.height));
    rectEl.setAttribute("rx", "20");
    rectEl.setAttribute("ry", "20");
    rectEl.setAttribute("fill", "none");
    rectEl.setAttribute("stroke", "black");
    parentGroup.appendChild(rectEl);
    return { x: rx, y: ry, width: rectInfo.width, height: rectInfo.height };
  }

  if (!text) return isNa ? rectInfo : undefined;

  const font = loadFont(fontPath);
  const scale = fontSize / font.unitsPerEm;

  // Build glyph paths with bounds tracking
  const glyphData: Array<{ d: string }> = [];

  let xCursor = 0;
  let globalMinX: number | null = null;
  let globalMinY: number | null = null;
  let globalMaxX: number | null = null;
  let globalMaxY: number | null = null;

  for (let ci = 0; ci < text.length; ci++) {
    const glyph = font.charToGlyph(text[ci]);
    if (glyph.index === 0) continue;

    const advance = (glyph.advanceWidth ?? 0) * scale;
    const bbox = glyph.getBoundingBox();

    const glyphWidth = (bbox.x2 - bbox.x1) * scale;
    const offsetX = (advance - glyphWidth) / 2;

    const glyphPath = glyph.getPath(xCursor + offsetX, 0, fontSize);
    const svgStr = glyphPath.toSVG(2);
    const match = svgStr.match(/d="([^"]+)"/);

    if (match) {
      const localMinX = xCursor + offsetX + bbox.x1 * scale;
      const localMaxX = xCursor + offsetX + bbox.x2 * scale;
      const localMinY = -(bbox.y2 * scale);
      const localMaxY = -(bbox.y1 * scale);

      if (globalMinX === null || localMinX < globalMinX) globalMinX = localMinX;
      if (globalMinY === null || localMinY < globalMinY) globalMinY = localMinY;
      if (globalMaxX === null || localMaxX > globalMaxX) globalMaxX = localMaxX;
      if (globalMaxY === null || localMaxY > globalMaxY) globalMaxY = localMaxY;

      glyphData.push({ d: match[1] });
    }

    xCursor += advance + trackingOffset;
  }

  // Draw rectangle if isNa
  let newRectInfo: RectInfo | undefined;
  if (isNa && glyphData.length > 0 && globalMinX !== null && globalMaxX !== null) {
    const textWidth = globalMaxX - globalMinX;
    const rectWidth = textWidth + 2 * margin;
    const rectHeight = customHeight ?? 232;
    const rx = boxCenterX - rectWidth / 2;
    const ry = boxCenterY - rectHeight / 2;
    newRectInfo = { x: rx, y: ry, width: rectWidth, height: rectHeight };

    const rectEl = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
    rectEl.setAttribute("x", String(rx));
    rectEl.setAttribute("y", String(ry));
    rectEl.setAttribute("width", String(rectWidth));
    rectEl.setAttribute("height", String(rectHeight));
    rectEl.setAttribute("rx", "20");
    rectEl.setAttribute("ry", "20");
    rectEl.setAttribute("fill", "none");
    rectEl.setAttribute("stroke", "black");
    if (parentGroup.firstChild) {
      parentGroup.insertBefore(rectEl, parentGroup.firstChild);
    } else {
      parentGroup.appendChild(rectEl);
    }
  }

  if (glyphData.length === 0) return isNa ? newRectInfo ?? rectInfo : undefined;

  // Center text in box
  const textCenterX = ((globalMinX ?? 0) + (globalMaxX ?? 0)) / 2;
  const textCenterY = ((globalMinY ?? 0) + (globalMaxY ?? 0)) / 2;
  const dx = boxCenterX - textCenterX;
  const dy = boxCenterY - textCenterY;

  for (const g of glyphData) {
    const pathEl = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    pathEl.setAttribute("d", g.d);
    pathEl.setAttribute("fill", fillColor);
    pathEl.setAttribute("transform", `translate(${dx},${dy})`);
    parentGroup.appendChild(pathEl);
  }

  return isNa ? newRectInfo ?? rectInfo : undefined;
}

/**
 * Insert multiple text components into SVG with sub-box division (UniqueKids multi-line).
 */
export function insertMultiTextSvg(
  doc: any,
  parentGroup: any,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  components: Array<{ text: string; fontPath: string; fontSize: number; trackingOffset: number }>,
  isNa = false,
  margin = 40,
  customHeight?: number,
  initialRectInfo?: RectInfo,
  lineSpacingAdjust = 20
): RectInfo | undefined {
  const numComp = components.length;
  if (numComp === 0) return undefined;

  const totalHeight = y1 - y0;
  const subBoxHeight = totalHeight / numComp;
  const offsetTotal = ((numComp - 1) * lineSpacingAdjust) / 2;

  let rectInfo = initialRectInfo;

  for (let i = 0; i < numComp; i++) {
    const comp = components[i]!;
    const subY0 = y0 + i * subBoxHeight - i * lineSpacingAdjust + offsetTotal;
    const subY1 = subY0 + subBoxHeight;

    const result = insertTextSvgCentered(
      doc,
      parentGroup,
      x0,
      subY0,
      x1,
      subY1,
      comp.text,
      comp.fontPath,
      comp.fontSize,
      comp.trackingOffset,
      "#0000FF",
      isNa,
      margin,
      customHeight,
      rectInfo
    );
    if (result) rectInfo = result;
  }

  return rectInfo;
}

/**
 * Parse an SVG file into a DOM Document.
 */
export function parseSvg(filePath: string): any {
  const content = fs.readFileSync(filePath, "utf-8");
  const parser = new DOMParser();
  return parser.parseFromString(content, "image/svg+xml");
}

/**
 * Serialize an SVG Document back to a string.
 */
export function serializeSvg(doc: any): string {
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(doc);
  // Strip any existing XML declaration to avoid duplicates
  const stripped = svgStr.replace(/<\?xml[^?]*\?>\s*/g, "");
  return `<?xml version="1.0" encoding="utf-8"?>\n${stripped}`;
}

/**
 * Apply fill color to all existing path elements in the SVG.
 */
export function applyColorToAllPaths(doc: any, fillColor: string): void {
  const paths = doc.getElementsByTagNameNS("http://www.w3.org/2000/svg", "path");
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    p.setAttribute("fill", fillColor);
    const style = p.getAttribute("style");
    if (style) {
      const newStyle = style.includes("fill:")
        ? style.replace(/fill:\s*[^;]+/, `fill:${fillColor}`)
        : `${style};fill:${fillColor}`;
      p.setAttribute("style", newStyle);
    }
  }
}

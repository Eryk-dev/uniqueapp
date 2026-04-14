/* eslint-disable @typescript-eslint/no-unused-vars */
declare module "opentype.js" {
  interface Glyph {
    index: number;
    advanceWidth: number | undefined;
    getPath(x: number, y: number, fontSize: number): Path;
    getBoundingBox(): { x1: number; y1: number; x2: number; y2: number };
  }

  interface Path {
    toSVG(decimalPlaces?: number): string;
  }

  interface OS2Table {
    sTypoAscender?: number;
    sTypoDescender?: number;
  }

  interface Tables {
    os2?: OS2Table;
  }

  interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    tables: Tables;
    charToGlyph(char: string): Glyph;
  }

  function parse(buffer: ArrayBuffer): Font;
}

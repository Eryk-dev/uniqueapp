import path from "path";

const ASSETS_DIR = path.join(process.cwd(), "assets");

export const UNIQUEBOX_CONFIG = {
  FONT_PATH: path.join(ASSETS_DIR, "fonts", "TC_LaserSans_heart-v2.ttf"),
  CSV_PATH: path.join(ASSETS_DIR, "templates", "uniquebox", "coordenadas_molde_novo.csv"),
  TEMPLATES_DIR: path.join(ASSETS_DIR, "templates", "uniquebox"),
  MARGEM_HORIZONTAL: 15,
  MARGEM_VERTICAL: 50,
  ESPACAMENTO_ENTRE_LINHAS: 1.2,
  COR_FILL: "#0000FF",
} as const;

export interface FontConfig {
  path: string;
  size: number;
  trackingOffset: number;
}

export const UNIQUEKIDS_CONFIG = {
  CSV_COORDENADAS: path.join(ASSETS_DIR, "templates", "uniquekids", "coordenadas_molde_uk.csv"),
  FONTES: {
    MALINDA: {
      path: path.join(ASSETS_DIR, "fonts", "Malinda.ttf"),
      size: 258.75,
      trackingOffset: -18,
    },
    FORMA: {
      path: path.join(ASSETS_DIR, "fonts", "Arialkids.otf"),
      size: 274.0,
      trackingOffset: -20,
    },
    TD: {
      path: path.join(ASSETS_DIR, "fonts", "Pacifico.ttf"),
      size: 70.67,
      trackingOffset: 0,
    },
  } as Record<string, FontConfig>,
  SVG_TEMPLATE_DIR: path.join(ASSETS_DIR, "templates", "uniquekids"),
  DEFAULT_SVG_TEMPLATE: path.join(ASSETS_DIR, "templates", "uniquekids", "Placa STD.svg"),
  LINE_SPACING_ADJUST: 20,
  PRODUCT_MAP: path.join(ASSETS_DIR, "templates", "letras.json"),
  RAINBOW: ["Vermelho", "Laranja", "Amarelo", "Verde", "Azul", "Anil", "Violeta"],
} as const;

export const BLOCO_CONFIG = {
  TEMPLATE_PATH: path.join(ASSETS_DIR, "templates", "bloco", "Blocos UniqueBox.svg"),
  SLOTS_PER_CHAPA: 30,
  BUCKET: "bloco-fotos",
  OUTPUT_BUCKET: "uniquebox-files",
} as const;

import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";
import { fetchNF, fetchOrder } from "@/lib/tiny/client";
import type { createServerClient } from "@/lib/supabase/server";

const EMITENTE = {
  razaoSocial: "UNIQUE COMERCIAL LTDA",
  cnpj: "51.825.293/0001-87",
  ie: "91021622-82",
  cep: "80220-295",
  cidadeUf: "CURITIBA - PR",
};

export interface DanfeEtiquetaData {
  chaveAcesso: string;
  numero: string;
  serie: string;
  dataEmissao: string;
  protocolo?: string | null;
  formaFrete?: string | null;
  destinatario: {
    nome: string;
    endereco: string;
    cpfCnpj: string;
    ie?: string | null;
  };
}

export async function loadDanfeData(
  tinyNfId: number,
  supabase: ReturnType<typeof createServerClient>,
  formaFrete?: string | null
): Promise<DanfeEtiquetaData> {
  const { data: nfRecord } = await supabase
    .from("notas_fiscais")
    .select("pedido_id, numero_nf, pedidos(tiny_pedido_id)")
    .eq("tiny_nf_id", tinyNfId)
    .single();

  if (!nfRecord) throw new Error(`NF ${tinyNfId} nao encontrada no banco`);

  const pedidoRel = nfRecord.pedidos as { tiny_pedido_id?: number } | null;
  const tinyPedidoId = pedidoRel?.tiny_pedido_id;
  if (!tinyPedidoId) throw new Error(`Pedido sem tiny_pedido_id (NF ${tinyNfId})`);

  const [nf, pedido] = await Promise.all([
    fetchNF(tinyNfId),
    fetchOrder(tinyPedidoId),
  ]);

  // Tiny pode apagar enderecoEntrega e mover o endereco pra observacoesInternas
  // no formato "Endereço original: rua, num, comp, bairro, cidade - UF, CEP".
  const endParsed = pedido.enderecoEntrega
    ?? parseEnderecoFromObs(pedido.observacoesInternas);

  const linhaRua = [endParsed?.endereco, endParsed?.numero, endParsed?.complemento, endParsed?.bairro]
    .filter((s) => s && String(s).trim())
    .join(", ");
  const municipio = endParsed?.municipio ?? "";
  const uf = endParsed?.uf ?? "";
  const cidadeUf = municipio && uf ? `${municipio} - ${uf}` : municipio || uf;
  const cidadeLinha = [endParsed?.cep, cidadeUf]
    .filter((s) => s && String(s).trim())
    .join(" ");
  const enderecoCompleto = [linhaRua, cidadeLinha].filter((s) => s).join(". ");

  // Fallback pra cliente.{nome,cpfCnpj} quando enderecoEntrega nao vem
  // (caso tipico de retirada na loja, sem endereco de entrega).
  return {
    chaveAcesso: nf.chaveAcesso ?? "",
    numero: String(nf.numero ?? nfRecord.numero_nf ?? ""),
    serie: String(nf.serie ?? ""),
    dataEmissao: nf.dataEmissao ?? "",
    protocolo: null,
    formaFrete: formaFrete ?? null,
    destinatario: {
      nome: pedido.enderecoEntrega?.nomeDestinatario ?? pedido.cliente?.nome ?? "",
      endereco: enderecoCompleto,
      cpfCnpj: pedido.enderecoEntrega?.cpfCnpj ?? pedido.cliente?.cpfCnpj ?? "",
      ie: pedido.enderecoEntrega?.inscricaoEstadual ?? null,
    },
  };
}

/**
 * Extrai "Endereço original: rua, num, comp, bairro, cidade - UF, CEP"
 * de observacoesInternas. Retorna null se nao encontrar.
 */
function parseEnderecoFromObs(obs?: string): {
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
} | null {
  if (!obs) return null;
  const match = obs.match(/Endere[çc]o original:\s*([^\n\r]+)/i);
  if (!match) return null;

  const partes = match[1]!.split(",").map((s) => s.trim()).filter(Boolean);
  if (partes.length < 4) return null;

  // Heuristica: CEP eh o item que matchea \d{5}-?\d{3}; cidade-UF contem ' - '
  let cep = "";
  let municipio = "";
  let uf = "";
  const restantes: string[] = [];

  for (const p of partes) {
    if (/^\d{5}-?\d{3}$/.test(p) && !cep) {
      cep = p;
    } else if (/^.+\s-\s[A-Z]{2}$/.test(p) && !municipio) {
      const idx = p.lastIndexOf(" - ");
      municipio = p.slice(0, idx).trim();
      uf = p.slice(idx + 3).trim();
    } else {
      restantes.push(p);
    }
  }

  // Resto na ordem: endereco, numero, complemento, bairro
  const [endereco = "", numero = "", complemento = "", bairro = ""] = restantes;

  return { endereco, numero, complemento, bairro, municipio, uf, cep };
}

export async function generateDanfeEtiqueta(data: DanfeEtiquetaData): Promise<Buffer> {
  // A6 paisagem: ~420 x 298 pt
  const W = 420;
  const H = 298;
  const doc = new PDFDocument({ size: [W, H], margin: 0 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const PAD = 14;
  const innerW = W - PAD * 2;
  const colDirX = PAD + innerW / 2 + 4;
  const colDirW = innerW / 2 - 4;

  // ── Banner identificador da modalidade (PACKAGE / RETIRADA / JADLOG) ─
  const banner = getBannerStyle(data.formaFrete);
  const BANNER_H = banner ? 22 : 0;
  if (banner) {
    doc.save();
    doc.rect(0, 0, W, BANNER_H).fill(banner.bg);
    doc
      .fillColor(banner.fg)
      .font("Helvetica-Bold")
      .fontSize(14)
      .text(banner.label, 0, 5, { width: W, align: "center" });
    doc.restore();
    doc.fillColor("#000000");
  }

  // ── Cabeçalho esquerdo ───────────────────────────────────────────────
  let yEsq = PAD + BANNER_H;
  doc.font("Helvetica-Bold").fontSize(8).text("DANFE SIMPLIFICADO - ETIQUETA", PAD, yEsq);
  yEsq += 10;
  doc.font("Helvetica").fontSize(7).text("1 - Saída", PAD, yEsq);
  yEsq += 10;
  doc.font("Helvetica-Bold").fontSize(8).text(`NÚMERO ${data.numero}  SÉRIE ${data.serie}`, PAD, yEsq);
  yEsq += 10;
  if (data.dataEmissao) {
    doc.font("Helvetica").fontSize(7).text(`EMISSÃO: ${formatarData(data.dataEmissao)}`, PAD, yEsq);
  }

  // ── Cabeçalho direito ────────────────────────────────────────────────
  let yDir = PAD + BANNER_H;
  doc.font("Helvetica-Bold").fontSize(8).text("CHAVE DE ACESSO", colDirX, yDir, { width: colDirW });
  yDir += 10;
  doc.font("Helvetica").fontSize(6.5).text(formatarChave(data.chaveAcesso), colDirX, yDir, { width: colDirW });
  yDir += 12;
  if (data.protocolo) {
    doc.font("Helvetica-Bold").fontSize(7.5).text("PROTOCOLO DE AUTORIZAÇÃO DE USO", colDirX, yDir, { width: colDirW });
    yDir += 9;
    doc.font("Helvetica").fontSize(7).text(data.protocolo, colDirX, yDir, { width: colDirW });
  }

  // ── Código de barras ─────────────────────────────────────────────────
  if (data.chaveAcesso && /^\d{44}$/.test(data.chaveAcesso)) {
    const bcBuffer = await bwipjs.toBuffer({
      bcid: "code128",
      text: data.chaveAcesso,
      scale: 2,
      height: 14,
      includetext: false,
    });
    doc.image(bcBuffer, PAD, 75 + BANNER_H, { width: innerW, height: 60 });
  }

  // Linha separadora
  let y = 145 + BANNER_H;
  doc.moveTo(PAD, y).lineTo(W - PAD, y).stroke();
  y += 6;

  // ── Emitente ─────────────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(8).text("EMITENTE", PAD, y);
  y += 10;
  doc.font("Helvetica").fontSize(7);
  doc.text(EMITENTE.razaoSocial, PAD, y); y += 9;
  doc.text(`${EMITENTE.cep} ${EMITENTE.cidadeUf}`, PAD, y); y += 9;
  doc.text(`CPF/CNPJ ${EMITENTE.cnpj}`, PAD, y);
  doc.text(`IE: ${EMITENTE.ie}`, PAD + innerW / 2, y);
  y += 12;

  doc.moveTo(PAD, y).lineTo(W - PAD, y).stroke();
  y += 6;

  // ── Destinatário ─────────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(8).text("DESTINATÁRIO", PAD, y);
  y += 10;
  doc.font("Helvetica").fontSize(7);
  doc.text(data.destinatario.nome, PAD, y); y += 9;
  doc.text(data.destinatario.endereco, PAD, y, { width: innerW });
  y += doc.heightOfString(data.destinatario.endereco, { width: innerW }) + 2;
  doc.text(`CPF/CNPJ ${data.destinatario.cpfCnpj}`, PAD, y);
  if (data.destinatario.ie) {
    doc.text(`IE: ${data.destinatario.ie}`, PAD + innerW / 2, y);
  }

  doc.end();
  return done;
}

function getBannerStyle(
  formaFrete: string | null | undefined
): { label: string; bg: string; fg: string } | null {
  const f = (formaFrete ?? "").trim().toLowerCase();
  if (!f) return null;
  if (f.includes("retirada")) return { label: "RETIRADA NA LOJA", bg: "#E8821C", fg: "#FFFFFF" };
  if (f.includes("package")) return { label: "PACKAGE", bg: "#000000", fg: "#FFFFFF" };
  if (f.includes("jadlog")) return { label: "JADLOG", bg: "#0033A0", fg: "#FFFFFF" };
  return null;
}

function formatarData(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return iso;
}

function formatarChave(chave: string): string {
  return chave.replace(/(\d{4})/g, "$1 ").trim();
}

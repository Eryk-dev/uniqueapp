/**
 * Folha impressa do romaneio — o documento que o motorista assina.
 *
 * HTML puro em vez de PDF no servidor: mesmo caminho da Produção da
 * Semana (window.open + window.print()). Fica num modulo separado da
 * pagina pra poder ser gerado fora do browser (preview/verificacao).
 */

import { EMITENTE } from "@/lib/emitente";

export type LinhaRomaneio = {
  numero_nf: number | null;
  numero_pedido: number | null;
  nome_cliente: string | null;
  linha_produto: string | null;
  cidade: string | null;
  uf: string | null;
  numero_expedicao: number | null;
  codigo_rastreio: string | null;
};

export type CabecalhoRomaneio = {
  numero: number;
  transportadora: string;
  created_at: string;
  observacoes?: string | null;
};

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildRomaneioHtml(
  romaneio: CabecalhoRomaneio,
  itens: LinhaRomaneio[]
): string {
  const dataStr = new Date(romaneio.created_at).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  const numeroStr = String(romaneio.numero).padStart(5, "0");

  const corpo = itens
    .map((item, i) => {
      const cidadeUf = [item.cidade, item.uf].filter(Boolean).join(" - ");
      const linha =
        item.linha_produto === "uniquekids"
          ? "KIDS"
          : item.linha_produto === "uniquebox"
          ? "BOX"
          : "—";
      return `<tr>
        <td class="idx">${i + 1}</td>
        <td class="mono">${item.numero_nf ?? "—"}</td>
        <td class="rastreio">${item.codigo_rastreio ? esc(item.codigo_rastreio) : "—"}</td>
        <td class="mono">${item.numero_pedido ? `#${item.numero_pedido}` : "—"}</td>
        <td>${esc(item.nome_cliente ?? "—")}</td>
        <td>${cidadeUf ? esc(cidadeUf) : "—"}</td>
        <td class="linha">${linha}</td>
        <td class="mono">${item.numero_expedicao ?? "—"}</td>
        <td class="chk"></td>
      </tr>`;
    })
    .join("");

  return `<!doctype html><html lang="pt-BR"><head>
    <meta charset="utf-8" />
    <title>Romaneio ${numeroStr} — ${esc(romaneio.transportadora)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: -apple-system, Arial, sans-serif; color: #18181b; margin: 28px; }
      header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
               border-bottom: 2px solid #18181b; padding-bottom: 10px; margin-bottom: 14px; }
      .emitente { font-size: 12px; line-height: 1.5; }
      .emitente strong { font-size: 14px; }
      .titulo { text-align: right; }
      .titulo h1 { font-size: 15px; margin: 0 0 2px; letter-spacing: .04em; white-space: nowrap; }
      .titulo .num { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
      .meta { display: flex; gap: 28px; font-size: 13px; margin-bottom: 14px; }
      .meta .rot { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #71717a; display: block; }
      .meta .val { font-weight: 600; }
      .obs { font-size: 12px; color: #52525b; margin: 0 0 14px; padding: 8px 10px; background: #fafafa;
             border-left: 3px solid #d4d4d8; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
      th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #e4e4e7;
               overflow: hidden; text-overflow: ellipsis; }
      th { font-size: 9px; text-transform: uppercase; letter-spacing: .03em; color: #71717a;
           border-bottom: 1.5px solid #18181b; }
      .mono { font-family: ui-monospace, monospace; white-space: nowrap; }
      /* O rastreio e' o que a transportadora confere na coleta — destaque. */
      .rastreio { font-family: ui-monospace, monospace; font-weight: 700; font-size: 11px;
                  white-space: nowrap; letter-spacing: -.01em; }
      .idx { width: 22px; color: #a1a1aa; font-variant-numeric: tabular-nums; }
      .linha { font-size: 10px; font-weight: 700; letter-spacing: .04em; color: #52525b; }
      .chk::before { content: ""; display: inline-block; width: 14px; height: 14px;
                     border: 1.5px solid #a1a1aa; border-radius: 3px; vertical-align: middle; }
      .total { margin-top: 12px; font-size: 14px; font-weight: 700; }
      .assinatura { margin-top: 34px; border-top: 1px solid #e4e4e7; padding-top: 14px;
                    page-break-inside: avoid; }
      .assinatura p { font-size: 12px; margin: 0 0 26px; }
      .linhas { display: flex; gap: 26px; font-size: 11px; color: #71717a; }
      .linhas div { border-top: 1px solid #18181b; padding-top: 4px; }
      .l-nome { flex: 2; } .l-doc { flex: 1; } .l-ass { flex: 2; } .l-data { flex: 1; }
      @media print { body { margin: 12mm; } thead { display: table-header-group; } }
    </style></head><body>
    <header>
      <div class="emitente">
        <strong>${EMITENTE.razaoSocial}</strong><br />
        CNPJ ${EMITENTE.cnpj} · IE ${EMITENTE.ie}<br />
        ${EMITENTE.cidadeUf} · CEP ${EMITENTE.cep}
      </div>
      <div class="titulo">
        <h1>ROMANEIO DE ENTREGA</h1>
        <div class="num">Nº ${numeroStr}</div>
      </div>
    </header>

    <div class="meta">
      <div><span class="rot">Transportadora</span><span class="val">${esc(
        romaneio.transportadora
      )}</span></div>
      <div><span class="rot">Data de emissão</span><span class="val">${dataStr}</span></div>
      <div><span class="rot">Volumes</span><span class="val">${itens.length}</span></div>
    </div>

    ${romaneio.observacoes ? `<p class="obs">${esc(romaneio.observacoes)}</p>` : ""}

    <table>
      <!-- table-layout:fixed + colgroup: sem isso o rastreio (o campo que a
           transportadora confere na coleta) quebra em duas linhas quando o
           nome do destinatario e' longo.
           Larguras em %, nao px: a folha e' vista na tela larga do navegador
           e impressa em A4 (~700px uteis). Com px, o A4 trunca "#56555" e
           "KIDS" enquanto Destinatario fica com toda a sobra na tela.
           Rastreio em 16% cabe o maior formato (Jadlog, 14 digitos).
           As colunas nowrap (#, NF, Rastreio, Pedido, Exp) tem folga porque
           truncam de verdade; Destinatario e Cidade quebram linha, entao
           perdem espaco sem perder informacao. Medido a 703px (A4 - margens):
           # cabe "999" (romaneio de 100+ volumes) e Pedido cabe 7 digitos. -->
      <colgroup>
        <col style="width:5%" /><col style="width:7%" /><col style="width:16%" />
        <col style="width:9%" /><col style="width:24%" /><col style="width:21%" />
        <col style="width:6%" /><col style="width:7%" /><col style="width:5%" />
      </colgroup>
      <thead><tr>
        <th></th><th>NF</th><th>Rastreio</th><th>Pedido</th><th>Destinatário</th>
        <th>Cidade / UF</th><th>Linha</th><th>Exp</th><th></th>
      </tr></thead>
      <tbody>${corpo}</tbody>
    </table>

    <p class="total">Total de volumes: ${itens.length}</p>

    <div class="assinatura">
      <p>Declaro ter recebido da ${EMITENTE.razaoSocial} os ${itens.length} volume(s)
         relacionados neste romaneio, em perfeitas condições aparentes.</p>
      <div class="linhas">
        <div class="l-nome">Nome legível</div>
        <div class="l-doc">RG / CPF</div>
        <div class="l-ass">Assinatura</div>
        <div class="l-data">Data</div>
      </div>
    </div>
  </body></html>`;
}

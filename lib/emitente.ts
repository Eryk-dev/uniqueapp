/**
 * Dados da Unique como emitente. Usados na etiqueta DANFE local e no
 * cabecalho do romaneio de transportadora.
 *
 * Fica fora de lib/generation pra poder ser importado tambem pelo client
 * (os modulos de geracao puxam pdfkit/fontkit, que nao vao pro browser).
 */
export const EMITENTE = {
  razaoSocial: "UNIQUE COMERCIAL LTDA",
  cnpj: "51.825.293/0001-87",
  ie: "91021622-82",
  cep: "80220-295",
  cidadeUf: "CURITIBA - PR",
} as const;

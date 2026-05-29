// Frete padrao aplicado quando o pedido vem do Tiny SEM transportador
// configurado (Shopify nem sempre manda forma de envio). Sem esse fallback o
// pedido vira "Sem frete": NF emitida sem etiqueta + agrupamento Tiny sem frete
// (incidentes #47770 / #47911, 2026-05-29). Loggi Econômica e' a modalidade
// mais usada (~79% dos pedidos). Ids confirmados no Tiny da Unique.
//
// Atencao: a Unique tem MULTIPLAS configs Loggi com ids distintos — este e' so
// o default. Pra detectar Loggi em geral, checar formaEnvio.nome via API (ver
// app/api/expedicoes/[id]/etiquetas/pdf/route.ts), nao comparar ids.
export const DEFAULT_SHIPPING = {
  formaEnvio: { id: 929831281, nome: 'Loggi' },
  formaFrete: { id: 929831289, nome: 'ECONÔMICA' },
  transportadorId: 773511709,
  transportadorNome: 'Entrega comum',
} as const;

// True quando o pedido do Tiny ja tem frete definido (formaFrete.id presente).
// formaFrete.id e' o que determina a modalidade/etiqueta — sua ausencia = "sem
// frete". Usado pra decidir quando aplicar o DEFAULT_SHIPPING.
export function hasFreteConfigurado(transportador?: {
  formaFrete?: { id?: number } | null;
} | null): boolean {
  return !!transportador?.formaFrete?.id;
}

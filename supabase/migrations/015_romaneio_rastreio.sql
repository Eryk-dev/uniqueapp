-- ============================================================
-- Codigo de rastreio no romaneio
--
-- Fonte: GET /expedicao/{idAgrupamento} → expedicoes[].logistica
-- .codigoRastreio / .urlRastreio. Uma chamada devolve o rastreio de
-- TODAS as NFs do agrupamento, entao o custo e' 1 request por
-- expedicao (nao por pedido).
--
-- Verificado em 2026-08-17 nas 14 expedicoes mais recentes: Loggi,
-- Jadlog e Correios [Próprio] vem 100% preenchidos. So' "Retirada na
-- Loja" vem vazio — e ela nem entra em romaneio.
--
-- Snapshot como o resto de romaneio_itens: o codigo impresso na folha
-- que o motorista assinou nao muda depois.
-- ============================================================

ALTER TABLE unique_app.romaneio_itens
  ADD COLUMN IF NOT EXISTS codigo_rastreio text,
  ADD COLUMN IF NOT EXISTS url_rastreio text;

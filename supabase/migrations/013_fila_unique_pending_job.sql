-- ============================================================
-- Índice único parcial: no máximo 1 job pendente/executando por
-- (pedido, tipo) na fila.
--
-- Necessário com o polling fallback (lib/tiny/poller.ts): webhook e
-- poller podem correr pra enfileirar o mesmo job na mesma janela; sem
-- isso, dois fiscal_duplication concorrentes pro mesmo pedido podem
-- gerar NF duplicada (mesma classe do incidente 2026-05-15). O segundo
-- INSERT falha e os handlers já ignoram erro de insert na fila.
--
-- Antes de aplicar, conferir se não há duplicados pendentes:
--   SELECT pedido_id, tipo, count(*) FROM unique_app.fila_execucao
--   WHERE status IN ('pendente','executando')
--   GROUP BY 1,2 HAVING count(*) > 1;
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_fila_job_ativo
  ON fila_execucao (pedido_id, tipo)
  WHERE status IN ('pendente', 'executando');

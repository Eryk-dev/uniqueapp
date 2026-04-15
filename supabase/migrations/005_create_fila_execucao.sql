-- ============================================================
-- FILA_EXECUCAO — job queue for Tiny API operations
-- ============================================================
CREATE TABLE fila_execucao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL REFERENCES pedidos(id),
  tipo text NOT NULL
    CHECK (tipo IN ('fiscal_duplication', 'enrichment')),
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'executando', 'concluido', 'erro')),
  tentativas integer NOT NULL DEFAULT 0,
  max_tentativas integer NOT NULL DEFAULT 3,
  erro text,
  proximo_retry_em timestamptz,
  executado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Indexes for worker polling
CREATE INDEX idx_fila_status_retry ON fila_execucao (status, proximo_retry_em)
  WHERE status = 'pendente';
CREATE INDEX idx_fila_pedido ON fila_execucao (pedido_id);
CREATE INDEX idx_fila_tipo ON fila_execucao (tipo);
CREATE INDEX idx_fila_criado ON fila_execucao (criado_em);

-- Auto-update atualizado_em
CREATE TRIGGER tr_fila_updated_at
  BEFORE UPDATE ON fila_execucao FOR EACH ROW EXECUTE FUNCTION update_updated_at();

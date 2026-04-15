-- ============================================================
-- WEBHOOK_LOGS — registra todo payload recebido de webhook
-- ============================================================
CREATE TABLE webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),

  -- Identificação
  source text NOT NULL,                    -- 'tiny-pedido', 'nf-autorizada', etc.
  endpoint text NOT NULL,                  -- '/api/webhooks/tiny-pedido'
  method text NOT NULL DEFAULT 'POST',

  -- Request
  headers jsonb DEFAULT '{}',
  body jsonb DEFAULT '{}',
  query_params jsonb DEFAULT '{}',

  -- Resultado do processamento
  status text NOT NULL DEFAULT 'recebido'
    CHECK (status IN ('recebido', 'processando', 'sucesso', 'erro', 'ignorado')),
  status_code integer,
  response_body jsonb,
  processing_ms integer,

  -- Contexto
  pedido_id uuid REFERENCES pedidos(id),
  tiny_pedido_id bigint,
  error_message text,

  -- Dedup
  dedup_key text UNIQUE,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes para consultas comuns
CREATE INDEX idx_webhook_logs_received_at ON webhook_logs (received_at DESC);
CREATE INDEX idx_webhook_logs_source ON webhook_logs (source);
CREATE INDEX idx_webhook_logs_status ON webhook_logs (status);
CREATE INDEX idx_webhook_logs_pedido ON webhook_logs (pedido_id) WHERE pedido_id IS NOT NULL;
CREATE INDEX idx_webhook_logs_tiny_pedido ON webhook_logs (tiny_pedido_id) WHERE tiny_pedido_id IS NOT NULL;
CREATE INDEX idx_webhook_logs_erro ON webhook_logs (source, received_at DESC) WHERE status = 'erro';

-- ============================================================
-- ERROS — rastreamento dedicado de erros com classificação
-- ============================================================
CREATE TABLE erros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp timestamptz NOT NULL DEFAULT now(),

  -- Classificação
  source text NOT NULL,                    -- 'webhook', 'job', 'api', 'trigger', etc.
  category text NOT NULL DEFAULT 'unknown'
    CHECK (category IN (
      'validation',       -- input inválido, campos faltando
      'database',         -- falhas de query no supabase
      'external_api',     -- falhas no Tiny ERP
      'auth',             -- problemas de token/sessão
      'config',           -- config ausente
      'business_logic',   -- regra de negócio violada
      'infrastructure',   -- timeout, rate limit, rede
      'unknown'
    )),
  severity text NOT NULL DEFAULT 'error'
    CHECK (severity IN ('warning', 'error', 'critical')),

  -- Detalhes do erro
  message text NOT NULL,
  stack_trace text,
  error_code text,

  -- Contexto
  pedido_id uuid REFERENCES pedidos(id),
  tiny_pedido_id bigint,
  webhook_log_id uuid REFERENCES webhook_logs(id),

  -- Rastreamento
  correlation_id text,
  request_path text,
  request_method text,

  -- Dados estruturados
  metadata jsonb DEFAULT '{}',

  -- Resolução
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by text,
  resolution_notes text,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes para consultas comuns
CREATE INDEX idx_erros_timestamp ON erros (timestamp DESC);
CREATE INDEX idx_erros_source ON erros (source);
CREATE INDEX idx_erros_category ON erros (category);
CREATE INDEX idx_erros_severity ON erros (severity);
CREATE INDEX idx_erros_pedido ON erros (pedido_id) WHERE pedido_id IS NOT NULL;
CREATE INDEX idx_erros_webhook_log ON erros (webhook_log_id) WHERE webhook_log_id IS NOT NULL;
CREATE INDEX idx_erros_correlation ON erros (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_erros_unresolved ON erros (resolved) WHERE resolved = false;
CREATE INDEX idx_erros_unresolved_by_source ON erros (source, timestamp DESC) WHERE resolved = false;
CREATE INDEX idx_erros_error_code ON erros (error_code) WHERE error_code IS NOT NULL;

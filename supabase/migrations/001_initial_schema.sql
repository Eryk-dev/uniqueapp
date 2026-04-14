-- ============================================================
-- Unified Production Platform - Initial Schema
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USUARIOS
-- ============================================================
CREATE TABLE usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  nome text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'operador', 'expedicao')),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- PEDIDOS
-- ============================================================
CREATE TABLE pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tiny_pedido_id bigint UNIQUE NOT NULL,
  numero integer NOT NULL,
  data_pedido date NOT NULL,
  id_pedido_ecommerce text,
  id_contato bigint,
  nome_ecommerce text NOT NULL,
  linha_produto text NOT NULL CHECK (linha_produto IN ('uniquebox', 'uniquekids')),
  status text NOT NULL DEFAULT 'recebido'
    CHECK (status IN (
      'recebido', 'nf_gerada', 'nf_autorizada', 'enriquecido',
      'pronto_producao', 'em_producao', 'produzido', 'expedido',
      'avulso_produzido',
      'erro_fiscal', 'erro_enriquecimento', 'erro_producao'
    )),
  nome_cliente text,
  forma_frete text,
  id_forma_envio bigint,
  id_forma_frete bigint,
  id_transportador bigint,
  is_avulso boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pedidos_status ON pedidos (status);
CREATE INDEX idx_pedidos_linha_produto ON pedidos (linha_produto);
CREATE INDEX idx_pedidos_created_at ON pedidos (created_at);
CREATE INDEX idx_pedidos_forma_frete ON pedidos (forma_frete);

-- ============================================================
-- NOTAS FISCAIS
-- ============================================================
CREATE TABLE notas_fiscais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL REFERENCES pedidos(id),
  tiny_nf_id bigint UNIQUE,
  tiny_pedido_clone_id bigint,
  numero_nf integer,
  modelo text DEFAULT '55',
  autorizada boolean NOT NULL DEFAULT false,
  autorizada_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_nf_pedido_id ON notas_fiscais (pedido_id);
CREATE INDEX idx_nf_autorizada ON notas_fiscais (autorizada) WHERE autorizada = false;

-- ============================================================
-- LOTES PRODUCAO
-- ============================================================
CREATE TABLE lotes_producao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  linha_produto text NOT NULL,
  status text NOT NULL DEFAULT 'processando'
    CHECK (status IN ('processando', 'concluido', 'erro_parcial')),
  total_itens integer NOT NULL,
  itens_sucesso integer NOT NULL DEFAULT 0,
  itens_erro integer NOT NULL DEFAULT 0,
  criado_por uuid REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX idx_lotes_status ON lotes_producao (status);
CREATE INDEX idx_lotes_created_at ON lotes_producao (created_at);

-- ============================================================
-- ITENS PRODUCAO
-- ============================================================
CREATE TABLE itens_producao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL REFERENCES pedidos(id),
  lote_id uuid REFERENCES lotes_producao(id),
  modelo text NOT NULL,
  molde text,
  fonte text,
  personalizacao text,
  has_personalizacao boolean NOT NULL DEFAULT true,
  tiny_nf_id bigint,
  numero_nf integer,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'produzido', 'erro')),
  erro_detalhe text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_itens_pedido_id ON itens_producao (pedido_id);
CREATE INDEX idx_itens_lote_id ON itens_producao (lote_id);
CREATE INDEX idx_itens_status ON itens_producao (status);
CREATE INDEX idx_itens_molde ON itens_producao (molde);

-- ============================================================
-- EXPEDICOES
-- ============================================================
CREATE TABLE expedicoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id uuid REFERENCES lotes_producao(id),
  tiny_expedicao_id bigint,
  forma_frete text NOT NULL,
  id_forma_frete bigint,
  id_transportador bigint,
  nf_ids bigint[] NOT NULL,
  status text NOT NULL DEFAULT 'criada'
    CHECK (status IN ('criada', 'erro')),
  erro_detalhe text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_expedicoes_lote_id ON expedicoes (lote_id);
CREATE INDEX idx_expedicoes_tiny_id ON expedicoes (tiny_expedicao_id);

-- ============================================================
-- ARQUIVOS
-- ============================================================
CREATE TABLE arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id uuid NOT NULL REFERENCES lotes_producao(id),
  tipo text NOT NULL CHECK (tipo IN ('svg', 'pdf')),
  nome_arquivo text NOT NULL,
  storage_path text NOT NULL,
  storage_bucket text NOT NULL,
  tamanho_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_arquivos_lote_id ON arquivos (lote_id);
CREATE INDEX idx_arquivos_tipo ON arquivos (tipo);

-- ============================================================
-- TAREFAS
-- ============================================================
CREATE TABLE tarefas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id uuid NOT NULL REFERENCES lotes_producao(id),
  titulo text NOT NULL,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'em_andamento', 'concluido')),
  notas text,
  atribuido_a uuid REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX idx_tarefas_status ON tarefas (status);
CREATE INDEX idx_tarefas_lote_id ON tarefas (lote_id);

-- ============================================================
-- EVENTOS
-- ============================================================
CREATE TABLE eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid REFERENCES pedidos(id),
  lote_id uuid REFERENCES lotes_producao(id),
  tipo text NOT NULL,
  descricao text NOT NULL,
  dados jsonb,
  ator text NOT NULL DEFAULT 'sistema',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_eventos_pedido_id ON eventos (pedido_id);
CREATE INDEX idx_eventos_lote_id ON eventos (lote_id);
CREATE INDEX idx_eventos_tipo ON eventos (tipo);
CREATE INDEX idx_eventos_created_at ON eventos (created_at);

-- ============================================================
-- Updated_at trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_usuarios_updated_at
  BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_pedidos_updated_at
  BEFORE UPDATE ON pedidos FOR EACH ROW EXECUTE FUNCTION update_updated_at();

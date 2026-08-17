-- ============================================================
-- Romaneio de transportadora
--
-- Lista de entrega que o motorista assina na coleta. Um romaneio =
-- uma transportadora + as NFs entregues naquele ato.
--
-- Cidade/UF do destinatario passam a ser guardadas em `pedidos`:
-- ingest e enrichment ja chamam fetchOrder no Tiny, entao sai de
-- graca. Sem isso o romaneio teria que bater no Tiny 1x por NF na
-- hora de gerar (~1.1s cada pelo rate limiter = 30s+ por romaneio).
-- ============================================================

ALTER TABLE unique_app.pedidos
  ADD COLUMN IF NOT EXISTS cidade text,
  ADD COLUMN IF NOT EXISTS uf text;

CREATE SEQUENCE IF NOT EXISTS unique_app.romaneios_numero_seq START 1;

CREATE TABLE unique_app.romaneios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Numero sequencial curto pra citar com a transportadora ("romaneio 42").
  numero integer NOT NULL UNIQUE DEFAULT nextval('unique_app.romaneios_numero_seq'),
  transportadora text NOT NULL,
  total_volumes integer NOT NULL DEFAULT 0,
  observacoes text,
  criado_por uuid REFERENCES unique_app.usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER SEQUENCE unique_app.romaneios_numero_seq OWNED BY unique_app.romaneios.numero;

CREATE INDEX idx_romaneios_created_at ON unique_app.romaneios (created_at DESC);
CREATE INDEX idx_romaneios_transportadora ON unique_app.romaneios (transportadora);

-- Uma linha por NF (= 1 volume = 1 etiqueta).
--
-- Os campos numero_nf/numero_pedido/nome_cliente/... sao SNAPSHOT do
-- momento da geracao, de proposito: a folha assinada nao pode mudar
-- se o pedido for editado no Tiny depois.
--
-- O UNIQUE em tiny_nf_id e' o coracao da tela: NF so entra em um
-- romaneio, entao "pendentes" = NF expedida que ainda nao esta aqui.
-- Pedido que a transportadora nao coletou hoje continua pendente
-- amanha em vez de sumir junto com o filtro de data.
CREATE TABLE unique_app.romaneio_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  romaneio_id uuid NOT NULL REFERENCES unique_app.romaneios(id) ON DELETE CASCADE,
  pedido_id uuid REFERENCES unique_app.pedidos(id),
  expedicao_id uuid REFERENCES unique_app.expedicoes(id),
  tiny_nf_id bigint NOT NULL UNIQUE,
  numero_nf integer,
  numero_pedido integer,
  nome_cliente text,
  linha_produto text,
  numero_expedicao integer,
  cidade text,
  uf text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_romaneio_itens_romaneio ON unique_app.romaneio_itens (romaneio_id);
CREATE INDEX idx_romaneio_itens_pedido ON unique_app.romaneio_itens (pedido_id);

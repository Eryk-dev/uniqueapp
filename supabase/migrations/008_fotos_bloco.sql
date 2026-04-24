-- ============================================================
-- Migration 008: fotos_bloco table + colunas sku/tem_fotos_bloco em itens_producao + bucket bloco-fotos
-- ============================================================

SET search_path TO unique_app, public;

-- 1. Novas colunas em itens_producao
ALTER TABLE unique_app.itens_producao
  ADD COLUMN IF NOT EXISTS tem_fotos_bloco boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sku text;

CREATE INDEX IF NOT EXISTS itens_producao_sku_idx ON unique_app.itens_producao(sku) WHERE sku IS NOT NULL;

-- 2. Tabela fotos_bloco
CREATE TABLE IF NOT EXISTS unique_app.fotos_bloco (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         uuid NOT NULL REFERENCES unique_app.itens_producao(id) ON DELETE CASCADE,
  posicao         smallint NOT NULL,
  shopify_url     text NOT NULL,
  storage_path    text,
  largura_px      int,
  altura_px       int,
  tamanho_bytes   int,
  content_type    text,
  status          text NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente', 'baixada', 'erro')),
  erro_detalhe    text,
  baixada_em      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, posicao)
);

CREATE INDEX IF NOT EXISTS fotos_bloco_item_id_idx ON unique_app.fotos_bloco(item_id);
CREATE INDEX IF NOT EXISTS fotos_bloco_status_erro_idx
  ON unique_app.fotos_bloco(status) WHERE status = 'erro';

-- Trigger pra updated_at (padrão idêntico aos outros updated_at do schema)
CREATE OR REPLACE FUNCTION unique_app.fotos_bloco_updated_at_trigger()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fotos_bloco_updated_at ON unique_app.fotos_bloco;
CREATE TRIGGER fotos_bloco_updated_at
  BEFORE UPDATE ON unique_app.fotos_bloco
  FOR EACH ROW
  EXECUTE FUNCTION unique_app.fotos_bloco_updated_at_trigger();

-- 3. Bucket bloco-fotos (public read — URL estável embutida em <image> do SVG)
INSERT INTO storage.buckets (id, name, public)
VALUES ('bloco-fotos', 'bloco-fotos', true)
ON CONFLICT (id) DO NOTHING;

-- Sem policies customizadas; service role bypassa RLS (padrão do projeto,
-- mesmo modelo do migration 003_storage_buckets.sql)

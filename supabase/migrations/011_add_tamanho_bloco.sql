-- Add tamanho_bloco column to itens_producao for the 3 bloco SKUs:
--   UB325 = P (10x15 cm),  UB326 = M (20x30 cm),  UB327 = G (40x60 cm)
-- NULL = item nao e' bloco OU pedido legado anterior a esta migration.
ALTER TABLE unique_app.itens_producao
  ADD COLUMN IF NOT EXISTS tamanho_bloco text
  CHECK (tamanho_bloco IN ('P', 'M', 'G'));

CREATE INDEX IF NOT EXISTS idx_itens_producao_tamanho_bloco
  ON unique_app.itens_producao (tamanho_bloco)
  WHERE tamanho_bloco IS NOT NULL;

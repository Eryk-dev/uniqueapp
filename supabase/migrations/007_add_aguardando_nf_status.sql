-- Add 'aguardando_nf' to pedidos status CHECK constraint
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_status_check;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_status_check CHECK (status IN (
  'recebido', 'aguardando_nf', 'nf_gerada', 'nf_autorizada', 'enriquecido',
  'pronto_producao', 'em_producao', 'produzido', 'expedido',
  'avulso_produzido',
  'erro_fiscal', 'erro_enriquecimento', 'erro_producao'
));

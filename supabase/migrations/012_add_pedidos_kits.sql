-- Adiciona coluna kits text[] em pedidos pra rastrear produtos-kit que aparecem
-- no pedido do Tiny mas nao viram itens de producao (sao pulados em enrichOrder).
-- Usado pela folha de conferencia pra destacar o pedido com fundo rosa e
-- listar uma row "KIT" com o nome do produto (ex: "Kit Surpresa de Amor").
ALTER TABLE unique_app.pedidos
  ADD COLUMN IF NOT EXISTS kits text[] NOT NULL DEFAULT '{}';

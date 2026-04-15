-- Drop the broken trigger (update_updated_at references 'updated_at' but column is 'atualizado_em')
DROP TRIGGER IF EXISTS tr_fila_updated_at ON fila_execucao;

-- Create function for atualizado_em column
CREATE OR REPLACE FUNCTION update_atualizado_em()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-create trigger with correct function
CREATE TRIGGER tr_fila_updated_at
  BEFORE UPDATE ON fila_execucao FOR EACH ROW EXECUTE FUNCTION update_atualizado_em();

-- ============================================================
-- Fiscal Pipeline Triggers
-- Uses pg_net to trigger Next.js API routes on status changes
-- ============================================================

-- Enable pg_net extension (available on Supabase)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ============================================================
-- Trigger: Order reaches 'recebido' → fiscal duplication
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_fiscal_duplication()
RETURNS TRIGGER AS $$
DECLARE
  base_url text;
BEGIN
  -- Only fire on new orders or status change to 'recebido'
  IF (TG_OP = 'INSERT' AND NEW.status = 'recebido')
     OR (TG_OP = 'UPDATE' AND NEW.status = 'recebido' AND OLD.status != 'recebido')
  THEN
    -- Skip avulso orders (they bypass fiscal pipeline)
    IF NEW.is_avulso = true THEN
      RETURN NEW;
    END IF;

    base_url := current_setting('app.settings.api_base_url', true);
    IF base_url IS NULL OR base_url = '' THEN
      RAISE WARNING 'app.settings.api_base_url not set, skipping fiscal trigger';
      RETURN NEW;
    END IF;

    PERFORM extensions.http_post(
      url := base_url || '/api/jobs/fiscal-duplication',
      body := json_build_object('pedido_id', NEW.id)::text,
      headers := json_build_object('Content-Type', 'application/json')::jsonb
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_pedido_fiscal_duplication
  AFTER INSERT OR UPDATE OF status ON pedidos
  FOR EACH ROW
  EXECUTE FUNCTION trigger_fiscal_duplication();

-- ============================================================
-- Trigger: Order reaches 'nf_autorizada' → enrichment
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_enrichment()
RETURNS TRIGGER AS $$
DECLARE
  base_url text;
BEGIN
  IF NEW.status = 'nf_autorizada' AND OLD.status != 'nf_autorizada' THEN
    base_url := current_setting('app.settings.api_base_url', true);
    IF base_url IS NULL OR base_url = '' THEN
      RAISE WARNING 'app.settings.api_base_url not set, skipping enrichment trigger';
      RETURN NEW;
    END IF;

    PERFORM extensions.http_post(
      url := base_url || '/api/jobs/enrichment',
      body := json_build_object('pedido_id', NEW.id)::text,
      headers := json_build_object('Content-Type', 'application/json')::jsonb
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_pedido_enrichment
  AFTER UPDATE OF status ON pedidos
  FOR EACH ROW
  EXECUTE FUNCTION trigger_enrichment();

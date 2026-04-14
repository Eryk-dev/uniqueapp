-- ============================================================
-- Storage Buckets for production files
-- ============================================================

-- Create private buckets for UniqueBox and UniqueKids files
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('uniquebox-files', 'uniquebox-files', false),
  ('uniquekids-files', 'uniquekids-files', false)
ON CONFLICT (id) DO NOTHING;

-- Allow service role full access (used by Flask API and Next.js backend)
-- No RLS policies needed since all access is via service role key

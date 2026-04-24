-- ============================================================
-- Migration 009: permite tipo 'png' em arquivos (além de svg/pdf)
-- ============================================================
-- Chapas de bloco agora são geradas como PNG 8505x13938 @ 400 DPI
-- (ver lib/generation/bloco-png.ts). SVG continua aceito para UniqueBox/Kids.

ALTER TABLE unique_app.arquivos
  DROP CONSTRAINT IF EXISTS arquivos_tipo_check;

ALTER TABLE unique_app.arquivos
  ADD CONSTRAINT arquivos_tipo_check
  CHECK (tipo IN ('svg', 'pdf', 'png'));

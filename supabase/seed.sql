-- Seed: Insert initial admin user
-- Password: admin123 (bcrypt hash)
INSERT INTO usuarios (username, password_hash, nome, role)
VALUES (
  'admin',
  '$2b$10$8K1p/aw0Y1yFibFGIR.yXeOPGTD7t0b5sF3Y6TfLMwEwqV5h5nGHq',
  'Administrador',
  'admin'
)
ON CONFLICT (username) DO NOTHING;

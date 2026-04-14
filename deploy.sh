#!/bin/bash
set -euo pipefail

# ============================================================
# Deploy script — Unique Platform para VPS
# Uso: ./deploy.sh <usuario@ip-do-vps>
# ============================================================

VPS="${1:?Uso: ./deploy.sh usuario@ip-do-vps}"
REMOTE_DIR="/opt/unique"

echo "==> Buildando Next.js (standalone)..."
npm run build

echo "==> Preparando arquivos para transferencia..."
TEMP_DIR=$(mktemp -d)

# Next.js standalone
cp -r .next/standalone "$TEMP_DIR/platform"
cp -r .next/static "$TEMP_DIR/platform/.next/static"
# public folder (se existir)
[ -d public ] && cp -r public "$TEMP_DIR/platform/public"
# Configs de deploy
cp ecosystem.config.js "$TEMP_DIR/platform/"
cp nginx.conf "$TEMP_DIR/platform/"

# Flask API
cp -r ../apis "$TEMP_DIR/apis"

echo "==> Enviando para VPS ($VPS)..."
rsync -avz --delete \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='.env*' \
  --exclude='output/' \
  "$TEMP_DIR/platform/" "$VPS:$REMOTE_DIR/platform/"

rsync -avz --delete \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='.env*' \
  --exclude='output/' \
  "$TEMP_DIR/apis/" "$VPS:$REMOTE_DIR/apis/"

rm -rf "$TEMP_DIR"

echo "==> Reiniciando servicos no VPS..."
ssh "$VPS" << 'REMOTE'
  set -euo pipefail

  cd /opt/unique/platform

  # Instalar dependencias Flask se requirements.txt existir
  if [ -f /opt/unique/apis/requirements.txt ]; then
    pip3 install -r /opt/unique/apis/requirements.txt --quiet
  fi

  # Garantir diretorio de logs
  sudo mkdir -p /var/log/unique
  sudo chown $(whoami) /var/log/unique

  # Restart via PM2
  if pm2 list | grep -q "platform"; then
    pm2 restart ecosystem.config.js
  else
    pm2 start ecosystem.config.js
  fi

  pm2 save

  echo "==> Deploy concluido!"
  pm2 status
REMOTE

#!/usr/bin/env bash
set -e

cd /app

# 初始化数据库表与 RSA 密钥
python -m scripts.startup_init || {
  echo "[entrypoint] startup_init failed"
  exit 1
}

exec gunicorn -c gunicorn.conf.py app.main:app

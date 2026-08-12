#!/usr/bin/env bash
set -Eeuo pipefail

export DEBIAN_FRONTEND=noninteractive

DOMAIN="yanlimpeza.venduss.com"
APP_NAME="yan-limpeza"
APP_USER="yanapp"
APP_ROOT="/opt/yan-limpeza"
APP_HOME="/var/lib/yan-limpeza"
APP_PORT="3107"
PACKAGE_URL="https://yan-limpeza.clovispsilva.chatgpt.site/2fa9bfc67097cac5f6d440cc26da6c72/yan-limpeza.tar.gz"
PACKAGE_SHA256="04196d1c8a1fa79e003d0b12f23e36ec466cdf54553fca118c37e259cfaf1272"
TMP_DIR="$(mktemp -d)"
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)"
RELEASE_DIR="${APP_ROOT}/releases/${RELEASE_ID}"
PREVIOUS_RELEASE=""
SWITCHED_RELEASE="0"

log() {
  printf '\n\033[1;34m[YAN]\033[0m %s\n' "$*"
}

fail() {
  printf '\n\033[1;31m[ERRO]\033[0m %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "${TMP_DIR:-}" && "${TMP_DIR}" == /tmp/* && -d "${TMP_DIR}" ]]; then
    rm -rf -- "${TMP_DIR}"
  fi
}

rollback() {
  local line="$1"
  printf '\n\033[1;31m[ERRO]\033[0m A instalação parou na linha %s.\n' "${line}" >&2
  if [[ "${SWITCHED_RELEASE}" == "1" && -n "${PREVIOUS_RELEASE}" && -d "${PREVIOUS_RELEASE}" ]]; then
    ln -sfn "${PREVIOUS_RELEASE}" "${APP_ROOT}/current.rollback"
    mv -Tf "${APP_ROOT}/current.rollback" "${APP_ROOT}/current"
    systemctl restart yan-limpeza.service >/dev/null 2>&1 || true
    printf 'A versão anterior foi restaurada.\n' >&2
  fi
  printf 'Envie uma foto deste erro para o Codex.\n' >&2
}

trap 'rollback $LINENO' ERR
trap cleanup EXIT

[[ "${EUID}" -eq 0 ]] || fail "Execute este comando depois de entrar como root."

log "Preparando o servidor"
apt-get update -y
apt-get install -y ca-certificates curl xz-utils tar openssl certbot

TOTAL_MEMORY_MB="$(free -m | awk '/^Mem:/ {print $2}')"
TOTAL_SWAP_MB="$(free -m | awk '/^Swap:/ {print $2}')"
if [[ "${TOTAL_MEMORY_MB}" -lt 1800 && "${TOTAL_SWAP_MB}" -lt 1024 ]]; then
  log "Criando memória auxiliar para a instalação"
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile 2>/dev/null || true
  grep -qE '^/swapfile[[:space:]]' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
fi

install_node() {
  if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
    return
  fi

  log "Instalando Node.js 22"
  local machine node_arch sums package
  machine="$(uname -m)"
  case "${machine}" in
    x86_64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *) fail "Arquitetura não suportada automaticamente: ${machine}" ;;
  esac

  sums="${TMP_DIR}/SHASUMS256.txt"
  curl -fsSL --retry 3 -o "${sums}" "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt"
  package="$(awk -v suffix="linux-${node_arch}.tar.xz" '$2 ~ suffix "$" {print $2; exit}' "${sums}")"
  [[ -n "${package}" ]] || fail "Não foi possível localizar o pacote do Node.js."
  curl -fsSL --retry 3 -o "${TMP_DIR}/${package}" "https://nodejs.org/dist/latest-v22.x/${package}"
  (
    cd "${TMP_DIR}"
    grep "  ${package}$" SHASUMS256.txt | sha256sum -c -
  )
  tar -xJf "${TMP_DIR}/${package}" -C /usr/local --strip-components=1
}

install_node
NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"
[[ -x "${NODE_BIN}" && -x "${NPM_BIN}" ]] || fail "Node.js ou npm não ficaram disponíveis."

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "${APP_HOME}" --shell /usr/sbin/nologin "${APP_USER}"
fi
install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_HOME}" "${APP_ROOT}/releases"

if [[ -L "${APP_ROOT}/current" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "${APP_ROOT}/current" || true)"
fi

log "Baixando a versão atual do sistema"
curl -fsSL --retry 4 --retry-delay 2 -o "${TMP_DIR}/yan-limpeza.tar.gz" "${PACKAGE_URL}"
printf '%s  %s\n' "${PACKAGE_SHA256}" "${TMP_DIR}/yan-limpeza.tar.gz" | sha256sum -c -

install -d "${RELEASE_DIR}"
tar -xzf "${TMP_DIR}/yan-limpeza.tar.gz" -C "${RELEASE_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${RELEASE_DIR}"

log "Instalando os componentes do sistema"
runuser -u "${APP_USER}" -- env HOME="${APP_HOME}" PATH="$(dirname "${NODE_BIN}"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  bash -lc "cd '${RELEASE_DIR}' && '${NPM_BIN}' ci --include=dev --no-audit --no-fund"

[[ -f "${RELEASE_DIR}/dist/server/index.js" ]] || fail "O pacote não contém a versão compilada do sistema."

ln -sfn "${RELEASE_DIR}" "${APP_ROOT}/current.next"
mv -Tf "${APP_ROOT}/current.next" "${APP_ROOT}/current"
SWITCHED_RELEASE="1"

log "Configurando o início automático"
cat > /etc/systemd/system/yan-limpeza.service <<EOF
[Unit]
Description=YAN Limpeza
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_ROOT}/current
Environment=NODE_ENV=production
Environment=HOME=${APP_HOME}
ExecStart=${NPM_BIN} start -- --port ${APP_PORT} --hostname 127.0.0.1
Restart=always
RestartSec=5
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${APP_ROOT} ${APP_HOME}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now yan-limpeza.service
systemctl restart yan-limpeza.service

APP_READY="0"
for _ in $(seq 1 45); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${APP_PORT}/" >/dev/null; then
    APP_READY="1"
    break
  fi
  sleep 1
done

if [[ "${APP_READY}" != "1" ]]; then
  journalctl -u yan-limpeza.service -n 80 --no-pager || true
  fail "O aplicativo não iniciou corretamente."
fi

find_nginx() {
  if command -v nginx >/dev/null 2>&1; then
    command -v nginx
    return
  fi
  for candidate in /usr/local/openresty/nginx/sbin/nginx /usr/sbin/nginx /usr/local/sbin/nginx; do
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return
    fi
  done
  local nginx_pid
  nginx_pid="$(pgrep -xo nginx || true)"
  if [[ -n "${nginx_pid}" && -e "/proc/${nginx_pid}/exe" ]]; then
    readlink -f "/proc/${nginx_pid}/exe"
  fi
}

NGINX_BIN="$(find_nginx || true)"
if [[ -z "${NGINX_BIN}" || ! -x "${NGINX_BIN}" ]]; then
  log "Instalando o servidor web"
  apt-get install -y nginx
  NGINX_BIN="$(command -v nginx)"
  systemctl enable --now nginx
fi

NGINX_VERSION_ARGS="$("${NGINX_BIN}" -V 2>&1 || true)"
NGINX_PREFIX="$(printf '%s\n' "${NGINX_VERSION_ARGS}" | sed -n 's/.*--prefix=\([^ ]*\).*/\1/p')"
NGINX_PREFIX="${NGINX_PREFIX:-/usr/local/openresty/nginx}"
NGINX_DUMP="$("${NGINX_BIN}" -T 2>&1 || true)"

choose_vhost_dir() {
  local pattern
  pattern="$(printf '%s\n' "${NGINX_DUMP}" | awk '
    /^[[:space:]]*include[[:space:]]+/ {
      p=$2
      gsub(/;/, "", p)
      if (p ~ /(conf\.d|sites-enabled|vhost|domains)/ && p ~ /\*/) {
        print p
        exit
      }
    }
  ')"

  if [[ -z "${pattern}" ]]; then
    return 1
  fi

  pattern="${pattern%%\**}"
  pattern="${pattern%/}"
  if [[ "${pattern}" == /* ]]; then
    printf '%s\n' "${pattern}"
  else
    printf '%s/%s\n' "${NGINX_PREFIX%/}" "${pattern}"
  fi
}

VHOST_DIR="$(choose_vhost_dir || true)"
[[ -n "${VHOST_DIR}" ]] || fail "Não encontrei automaticamente a pasta de configuração do OpenResty/Nginx."
install -d "${VHOST_DIR}"
VHOST_CONF="${VHOST_DIR}/yan-limpeza.conf"
ACME_ROOT="/var/www/yan-certbot"
install -d "${ACME_ROOT}/.well-known/acme-challenge"

write_http_vhost() {
  cat > "${VHOST_CONF}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_ROOT};
        default_type text/plain;
    }

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF
}

reload_nginx() {
  "${NGINX_BIN}" -t
  systemctl reload nginx 2>/dev/null || \
    systemctl reload openresty 2>/dev/null || \
    "${NGINX_BIN}" -s reload
}

log "Configurando o domínio"
write_http_vhost
reload_nginx

if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  log "Gerando o certificado HTTPS"
  certbot certonly \
    --webroot \
    --webroot-path "${ACME_ROOT}" \
    --domain "${DOMAIN}" \
    --non-interactive \
    --agree-tos \
    --register-unsafely-without-email \
    --preferred-challenges http
fi

[[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]] || fail "O certificado HTTPS não foi criado."

cat > "${VHOST_CONF}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_ROOT};
        default_type text/plain;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:YANSSL:10m;
    ssl_session_timeout 1d;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
    }
}
EOF

reload_nginx

install -d /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-yan-nginx.sh <<EOF
#!/usr/bin/env bash
set -e
"${NGINX_BIN}" -t
systemctl reload nginx 2>/dev/null || systemctl reload openresty 2>/dev/null || "${NGINX_BIN}" -s reload
EOF
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-yan-nginx.sh

curl -fsS --max-time 10 --resolve "${DOMAIN}:443:127.0.0.1" "https://${DOMAIN}/" >/dev/null

SWITCHED_RELEASE="0"
systemctl is-active --quiet yan-limpeza.service

printf '\n\033[1;32mYAN Limpeza instalada com sucesso.\033[0m\n'
printf 'Site: https://%s\n' "${DOMAIN}"
printf 'Administração: https://%s/app\n' "${DOMAIN}"

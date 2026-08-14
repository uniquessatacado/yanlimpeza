#!/usr/bin/env bash
set -Eeuo pipefail

export DEBIAN_FRONTEND=noninteractive

DOMAIN="yanlimpeza.venduss.com"
APP_NAME="yan-limpeza"
APP_USER="yanapp"
APP_ROOT="/opt/yan-limpeza"
APP_HOME="/var/lib/yan-limpeza"
APP_PORT="3107"
APP_VERSION="14"
PACKAGE_URL="https://yan-limpeza.clovispsilva.chatgpt.site/2fa9bfc67097cac5f6d440cc26da6c72/yan-limpeza.tar.gz"
PACKAGE_SHA256="2d920edc5e2597cd21b7e6f3a371a9f7092a8642c4cca2b1043a123698d3fb32"
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

if [[ -L "${APP_ROOT}/current" && -f "${APP_ROOT}/current/package.json" ]]; then
  log "Atualizando o YAN Limpeza para a versão ${APP_VERSION}"
fi

log "Preparando o servidor"
apt-get update -y
apt-get install -y ca-certificates curl xz-utils tar openssl python3-venv

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
  hash -r
}

install_node
hash -r
NODE_BIN=""
for candidate in /usr/local/bin/node "$(command -v node 2>/dev/null || true)"; do
  if [[ -n "${candidate}" && -x "${candidate}" ]] && "${candidate}" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
    NODE_BIN="${candidate}"
    break
  fi
done
[[ -n "${NODE_BIN}" ]] || fail "O Node.js 22 não ficou disponível."

export PATH="$(dirname "${NODE_BIN}"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
hash -r
NPM_BIN="$(command -v npm)"
NPM_CLI="$(readlink -f "${NPM_BIN}")"
[[ -x "${NPM_BIN}" && -f "${NPM_CLI}" ]] || fail "O npm não ficou disponível."
log "Usando $("${NODE_BIN}" --version)"

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
runuser -u "${APP_USER}" -- env HOME="${APP_HOME}" PATH="${PATH}" \
  bash -c "cd '${RELEASE_DIR}' && exec '${NODE_BIN}' '${NPM_CLI}' ci --include=dev --no-audit --no-fund"

[[ -f "${RELEASE_DIR}/dist/server/index.js" ]] || fail "O pacote não contém a versão compilada do sistema."
VINEXT_CLI="${RELEASE_DIR}/node_modules/vinext/dist/cli.js"
[[ -f "${VINEXT_CLI}" ]] || fail "O inicializador do sistema não foi instalado."

find_npm_container() {
  command -v docker >/dev/null 2>&1 || return 1

  local container_id image_name
  while read -r container_id image_name; do
    if [[ "${image_name,,}" == *"nginx-proxy-manager"* || "${image_name,,}" == *"nginxproxymanager"* ]]; then
      printf '%s\n' "${container_id}"
      return
    fi
  done < <(docker ps --format '{{.ID}} {{.Image}}')

  while read -r container_id; do
    if docker exec "${container_id}" sh -c 'test -d /data/nginx/proxy_host && command -v nginx >/dev/null 2>&1' >/dev/null 2>&1; then
      printf '%s\n' "${container_id}"
      return
    fi
  done < <(docker ps -q)

  return 1
}

NPM_CONTAINER="$(find_npm_container || true)"
NPM_CONTAINER_NAME=""
NPM_DATA_HOST=""
NPM_NETWORK_MODE=""
NPM_NETWORK=""
NPM_GATEWAY=""
APP_BIND="127.0.0.1"

if [[ -n "${NPM_CONTAINER}" ]]; then
  log "Nginx Proxy Manager detectado"
  NPM_CONTAINER_NAME="$(docker inspect --format '{{.Name}}' "${NPM_CONTAINER}" | sed 's#^/##')"
  NPM_DATA_HOST="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "${NPM_CONTAINER}")"
  NPM_NETWORK_MODE="$(docker inspect --format '{{.HostConfig.NetworkMode}}' "${NPM_CONTAINER}")"
  [[ -n "${NPM_CONTAINER_NAME}" && -n "${NPM_DATA_HOST}" && -d "${NPM_DATA_HOST}" ]] || \
    fail "Não foi possível localizar os dados persistentes do Nginx Proxy Manager."

  if [[ "${NPM_NETWORK_MODE}" != "host" ]]; then
    NPM_NETWORK="$(docker inspect --format '{{range $name, $settings := .NetworkSettings.Networks}}{{println $name}}{{end}}' "${NPM_CONTAINER}" | awk '$1 != "bridge" && $1 != "host" && $1 != "none" {print; exit}')"
    NPM_GATEWAY="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.Gateway}} {{end}}' "${NPM_CONTAINER}" | awk '{print $1}')"
    [[ -n "${NPM_NETWORK}" && -n "${NPM_GATEWAY}" ]] || fail "Não foi possível localizar a rede do Nginx Proxy Manager."
    APP_BIND="${NPM_GATEWAY}"
  fi
fi

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
Environment=PATH=$(dirname "${NODE_BIN}"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=${NODE_BIN} ${APP_ROOT}/current/node_modules/vinext/dist/cli.js start --port ${APP_PORT} --hostname ${APP_BIND}
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
  if curl -fsS --max-time 3 "http://${APP_BIND}:${APP_PORT}/" >/dev/null; then
    APP_READY="1"
    break
  fi
  sleep 1
done

if [[ "${APP_READY}" != "1" ]]; then
  journalctl -u yan-limpeza.service -n 80 --no-pager || true
  fail "O aplicativo não iniciou corretamente."
fi

npm_http_get() {
  local url="$1"
  local host_header="${2:-}"
  local insecure="${3:-0}"
  docker exec "${NPM_CONTAINER_NAME}" sh -c '
    url="$1"
    host_header="$2"
    insecure="$3"
    if command -v curl >/dev/null 2>&1; then
      if [ "${insecure}" = "1" ]; then
        if [ -n "${host_header}" ]; then
          exec curl -kfsS --max-time 15 -H "Host: ${host_header}" "${url}"
        fi
        exec curl -kfsS --max-time 15 "${url}"
      fi
      if [ -n "${host_header}" ]; then
        exec curl -fsS --max-time 15 -H "Host: ${host_header}" "${url}"
      fi
      exec curl -fsS --max-time 15 "${url}"
    fi
    if command -v wget >/dev/null 2>&1; then
      tls_option=""
      [ "${insecure}" = "1" ] && tls_option="--no-check-certificate"
      if [ -n "${host_header}" ]; then
        exec wget -qO- ${tls_option} --timeout=15 --header="Host: ${host_header}" "${url}"
      fi
      exec wget -qO- ${tls_option} --timeout=15 "${url}"
    fi
    exit 127
  ' sh "${url}" "${host_header}" "${insecure}"
}

NPM_UPSTREAM_HOST="${APP_BIND}"
if [[ -n "${NPM_CONTAINER}" && "${NPM_NETWORK_MODE}" != "host" ]]; then
  log "Conectando o sistema à rede do Nginx Proxy Manager"
  RELEASE_SOURCE="$(readlink -f "${APP_ROOT}/current")"
  docker pull node:22-bookworm-slim >/dev/null
  docker rm -f yan-limpeza-app >/dev/null 2>&1 || true
  docker run -d \
    --name yan-limpeza-app \
    --restart unless-stopped \
    --network "${NPM_NETWORK}" \
    --mount "type=bind,src=${RELEASE_SOURCE},dst=/app,readonly" \
    --workdir /app \
    --env NODE_ENV=production \
    node:22-bookworm-slim \
    node node_modules/vinext/dist/cli.js start --port "${APP_PORT}" --hostname 0.0.0.0 >/dev/null

  NPM_UPSTREAM_HOST="yan-limpeza-app"
  CONTAINER_READY="0"
  for _ in $(seq 1 45); do
    if npm_http_get "http://${NPM_UPSTREAM_HOST}:${APP_PORT}/" >/dev/null 2>&1; then
      CONTAINER_READY="1"
      break
    fi
    sleep 1
  done
  if [[ "${CONTAINER_READY}" != "1" ]]; then
    docker logs --tail 80 yan-limpeza-app || true
    fail "O aplicativo não iniciou na rede do Nginx Proxy Manager."
  fi
  systemctl disable --now yan-limpeza.service >/dev/null 2>&1 || true
fi

prepare_certbot() {
  local system_certbot certbot_venv
  system_certbot="$(command -v certbot 2>/dev/null || true)"
  if [[ -n "${system_certbot}" ]] && "${system_certbot}" --version >/dev/null 2>&1; then
    CERTBOT_BIN="${system_certbot}"
    return
  fi

  log "Preparando o certificado HTTPS"
  certbot_venv="/opt/yan-certbot"
  python3 -m venv "${certbot_venv}"
  "${certbot_venv}/bin/python" -m pip install \
    --disable-pip-version-check \
    --no-cache-dir \
    --upgrade pip setuptools wheel certbot
  CERTBOT_BIN="${certbot_venv}/bin/certbot"
  "${CERTBOT_BIN}" --version >/dev/null
}

CERTBOT_BIN=""
prepare_certbot

if [[ -n "${NPM_CONTAINER}" ]]; then
  log "Configurando o domínio no Nginx Proxy Manager"
  docker exec "${NPM_CONTAINER_NAME}" nginx -T 2>&1 | grep -F '/data/nginx/proxy_host/*.conf' >/dev/null || \
    fail "A pasta de hosts do Nginx Proxy Manager não está ativa."
  NPM_PROXY_DIR_HOST="${NPM_DATA_HOST}/nginx/proxy_host"
  NPM_VHOST_HOST="${NPM_PROXY_DIR_HOST}/99999-yan-limpeza.conf"
  NPM_ACME_HOST="${NPM_DATA_HOST}/yan-acme"
  NPM_SSL_HOST="${NPM_DATA_HOST}/yan-ssl"
  install -d "${NPM_PROXY_DIR_HOST}" "${NPM_ACME_HOST}/.well-known/acme-challenge" "${NPM_SSL_HOST}"

  cat > "${NPM_VHOST_HOST}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location ^~ /.well-known/acme-challenge/ {
        root /data/yan-acme;
        default_type text/plain;
        try_files \$uri =404;
    }

    location / {
        proxy_pass http://${NPM_UPSTREAM_HOST}:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF

  docker exec "${NPM_CONTAINER_NAME}" nginx -t
  docker exec "${NPM_CONTAINER_NAME}" nginx -s reload

  PREFLIGHT_TOKEN="yan-preflight-${RELEASE_ID}"
  printf '%s\n' "${PREFLIGHT_TOKEN}" > "${NPM_ACME_HOST}/.well-known/acme-challenge/${PREFLIGHT_TOKEN}"
  PREFLIGHT_RESPONSE="$(npm_http_get \
    "http://127.0.0.1/.well-known/acme-challenge/${PREFLIGHT_TOKEN}" \
    "${DOMAIN}" || true)"
  rm -f -- "${NPM_ACME_HOST}/.well-known/acme-challenge/${PREFLIGHT_TOKEN}"
  [[ "${PREFLIGHT_RESPONSE}" == "${PREFLIGHT_TOKEN}" ]] || \
    fail "O Nginx Proxy Manager não publicou a rota de validação do HTTPS."

  if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    log "Gerando o certificado HTTPS"
    "${CERTBOT_BIN}" certonly \
      --webroot \
      --webroot-path "${NPM_ACME_HOST}" \
      --domain "${DOMAIN}" \
      --non-interactive \
      --agree-tos \
      --register-unsafely-without-email \
      --preferred-challenges http
  fi

  [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]] || fail "O certificado HTTPS não foi criado."
  install -m 0644 "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" "${NPM_SSL_HOST}/fullchain.pem"
  install -m 0600 "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" "${NPM_SSL_HOST}/privkey.pem"

  cat > "${NPM_VHOST_HOST}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location ^~ /.well-known/acme-challenge/ {
        root /data/yan-acme;
        default_type text/plain;
        try_files \$uri =404;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /data/yan-ssl/fullchain.pem;
    ssl_certificate_key /data/yan-ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:YANSSL:10m;
    ssl_session_timeout 1d;
    client_max_body_size 20m;

    location / {
        proxy_pass http://${NPM_UPSTREAM_HOST}:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
    }
}
EOF

  docker exec "${NPM_CONTAINER_NAME}" nginx -t
  docker exec "${NPM_CONTAINER_NAME}" nginx -s reload

  install -d /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/reload-yan-nginx.sh <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
install -m 0644 "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" "${NPM_SSL_HOST}/fullchain.pem"
install -m 0600 "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" "${NPM_SSL_HOST}/privkey.pem"
docker exec "${NPM_CONTAINER_NAME}" nginx -t
docker exec "${NPM_CONTAINER_NAME}" nginx -s reload
EOF
  chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-yan-nginx.sh
else

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
NGINX_PID_FILE="$(printf '%s\n' "${NGINX_DUMP}" | awk '
  /^[[:space:]]*pid[[:space:]]+/ {
    p=$2
    gsub(/;/, "", p)
    print p
    exit
  }
')"
NGINX_PID_FILE="${NGINX_PID_FILE:-/run/nginx.pid}"
if [[ "${NGINX_PID_FILE}" != /* ]]; then
  NGINX_PID_FILE="${NGINX_PREFIX%/}/${NGINX_PID_FILE}"
fi

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
  if systemctl is-active --quiet nginx 2>/dev/null && systemctl reload nginx 2>/dev/null; then
    return
  fi
  if systemctl is-active --quiet openresty 2>/dev/null && systemctl reload openresty 2>/dev/null; then
    return
  fi

  local master_pid
  master_pid="$(pgrep -xo nginx || pgrep -xo openresty || true)"
  if [[ -n "${master_pid}" ]]; then
    install -d "$(dirname "${NGINX_PID_FILE}")"
    printf '%s\n' "${master_pid}" > "${NGINX_PID_FILE}"
    "${NGINX_BIN}" -s reload
  else
    "${NGINX_BIN}"
  fi
}

log "Configurando o domínio"
write_http_vhost
reload_nginx

if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  log "Gerando o certificado HTTPS"
  "${CERTBOT_BIN}" certonly \
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
fi

cat > /etc/systemd/system/yan-certbot-renew.service <<EOF
[Unit]
Description=Renovar certificado HTTPS do YAN Limpeza
After=network-online.target

[Service]
Type=oneshot
ExecStart=${CERTBOT_BIN} renew --quiet
EOF

cat > /etc/systemd/system/yan-certbot-renew.timer <<'EOF'
[Unit]
Description=Renovação automática do HTTPS do YAN Limpeza

[Timer]
OnCalendar=*-*-* 03:20:00
RandomizedDelaySec=12h
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now yan-certbot-renew.timer

if [[ -z "${NPM_CONTAINER}" ]]; then
  curl -fsS --max-time 10 --resolve "${DOMAIN}:443:127.0.0.1" "https://${DOMAIN}/" >/dev/null
fi

SWITCHED_RELEASE="0"
if [[ -n "${NPM_CONTAINER}" && "${NPM_NETWORK_MODE}" != "host" ]]; then
  [[ "$(docker inspect --format '{{.State.Running}}' yan-limpeza-app 2>/dev/null)" == "true" ]]
else
  systemctl is-active --quiet yan-limpeza.service
fi

printf '\n\033[1;32mYAN Limpeza instalada com sucesso.\033[0m\n'
printf 'Site: https://%s\n' "${DOMAIN}"
printf 'Administração: https://%s/app\n' "${DOMAIN}"

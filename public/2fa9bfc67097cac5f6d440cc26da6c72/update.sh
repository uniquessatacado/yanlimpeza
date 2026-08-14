#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="yan-limpeza"
APP_USER="yanapp"
APP_ROOT="/opt/yan-limpeza"
APP_HOME="/var/lib/yan-limpeza"
APP_PORT="3107"
APP_VERSION="12"
PACKAGE_URL="https://yan-limpeza.clovispsilva.chatgpt.site/2fa9bfc67097cac5f6d440cc26da6c72/yan-limpeza.tar.gz"
PACKAGE_SHA256="e301ebfa10bcb80d4b8741dcf340f7c8e3c97caa9f2465b82d2c52eccf89f231"
TMP_DIR="$(mktemp -d)"
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)"
RELEASE_DIR="${APP_ROOT}/releases/${RELEASE_ID}"
PREVIOUS_RELEASE=""
SWITCHED_RELEASE="0"
DOCKER_MODE="0"
DOCKER_NETWORK=""
DOCKER_IMAGE="node:22-bookworm-slim"

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

start_docker_release() {
  local source_dir="$1"
  docker rm -f yan-limpeza-app >/dev/null 2>&1 || true
  docker run -d \
    --name yan-limpeza-app \
    --restart unless-stopped \
    --network "${DOCKER_NETWORK}" \
    --mount "type=bind,src=${source_dir},dst=/app,readonly" \
    --workdir /app \
    --env NODE_ENV=production \
    "${DOCKER_IMAGE}" \
    node node_modules/vinext/dist/cli.js start --port "${APP_PORT}" --hostname 0.0.0.0 >/dev/null
}

wait_for_docker() {
  local ready="0"
  for _ in $(seq 1 60); do
    if docker exec yan-limpeza-app node -e \
      "fetch('http://127.0.0.1:${APP_PORT}/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
      ready="1"
      break
    fi
    sleep 1
  done
  [[ "${ready}" == "1" ]]
}

rollback() {
  local line="$1"
  trap - ERR
  set +e
  printf '\n\033[1;31m[ERRO]\033[0m A atualização parou na linha %s.\n' "${line}" >&2
  if [[ "${SWITCHED_RELEASE}" == "1" && -n "${PREVIOUS_RELEASE}" && -d "${PREVIOUS_RELEASE}" ]]; then
    ln -sfn "${PREVIOUS_RELEASE}" "${APP_ROOT}/current.rollback"
    mv -Tf "${APP_ROOT}/current.rollback" "${APP_ROOT}/current"
    if [[ "${DOCKER_MODE}" == "1" ]]; then
      start_docker_release "${PREVIOUS_RELEASE}"
      wait_for_docker
    else
      systemctl restart yan-limpeza.service
    fi
    printf 'A versão anterior foi restaurada automaticamente.\n' >&2
  fi
  printf 'Envie uma foto deste erro para o Codex.\n' >&2
  exit 1
}

trap 'rollback $LINENO' ERR
trap cleanup EXIT

[[ "${EUID}" -eq 0 ]] || fail "Execute este comando como root."
[[ -L "${APP_ROOT}/current" && -f "${APP_ROOT}/current/package.json" ]] || \
  fail "A instalação atual do YAN Limpeza não foi encontrada."
id "${APP_USER}" >/dev/null 2>&1 || fail "O usuário interno do aplicativo não foi encontrado."

NODE_BIN="$(command -v node || true)"
[[ -n "${NODE_BIN}" ]] || fail "O Node.js não foi encontrado."
"${NODE_BIN}" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || \
  fail "É necessário ter o Node.js 22 ou superior."
NPM_BIN="$(command -v npm || true)"
NPM_CLI="$(readlink -f "${NPM_BIN}")"
[[ -n "${NPM_BIN}" && -f "${NPM_CLI}" ]] || fail "O npm não foi encontrado."

PREVIOUS_RELEASE="$(readlink -f "${APP_ROOT}/current")"

if command -v docker >/dev/null 2>&1 && docker inspect yan-limpeza-app >/dev/null 2>&1; then
  DOCKER_MODE="1"
  DOCKER_NETWORK="$(docker inspect --format '{{.HostConfig.NetworkMode}}' yan-limpeza-app)"
  DOCKER_IMAGE="$(docker inspect --format '{{.Config.Image}}' yan-limpeza-app)"
  [[ -n "${DOCKER_NETWORK}" && -n "${DOCKER_IMAGE}" ]] || \
    fail "Não foi possível identificar a rede do aplicativo."
fi

log "Baixando a atualização ${APP_VERSION}"
curl -fsSL --retry 4 --retry-delay 2 -o "${TMP_DIR}/yan-limpeza.tar.gz" "${PACKAGE_URL}"
printf '%s  %s\n' "${PACKAGE_SHA256}" "${TMP_DIR}/yan-limpeza.tar.gz" | sha256sum -c -

install -d "${RELEASE_DIR}"
tar -xzf "${TMP_DIR}/yan-limpeza.tar.gz" -C "${RELEASE_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${RELEASE_DIR}"

log "Instalando os componentes"
runuser -u "${APP_USER}" -- env HOME="${APP_HOME}" PATH="${PATH}" \
  bash -c "cd '${RELEASE_DIR}' && exec '${NODE_BIN}' '${NPM_CLI}' ci --include=dev --no-audit --no-fund"

[[ -f "${RELEASE_DIR}/dist/server/index.js" ]] || fail "A versão compilada não veio no pacote."
[[ -f "${RELEASE_DIR}/node_modules/vinext/dist/cli.js" ]] || fail "O inicializador não foi instalado."

ln -sfn "${RELEASE_DIR}" "${APP_ROOT}/current.next"
mv -Tf "${APP_ROOT}/current.next" "${APP_ROOT}/current"
SWITCHED_RELEASE="1"

log "Iniciando a nova versão"
if [[ "${DOCKER_MODE}" == "1" ]]; then
  start_docker_release "${RELEASE_DIR}"
  if ! wait_for_docker; then
    docker logs --tail 100 yan-limpeza-app || true
    fail "A nova versão não iniciou corretamente."
  fi
else
  systemctl restart yan-limpeza.service
  ready="0"
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 3 "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
      ready="1"
      break
    fi
    sleep 1
  done
  if [[ "${ready}" != "1" ]]; then
    journalctl -u yan-limpeza.service -n 100 --no-pager || true
    fail "A nova versão não iniciou corretamente."
  fi
fi

SWITCHED_RELEASE="0"
printf '\n\033[1;32mYAN Limpeza atualizado com sucesso.\033[0m\n'
printf 'Versão: %s\n' "${APP_VERSION}"
printf 'Site: https://yanlimpeza.venduss.com\n'

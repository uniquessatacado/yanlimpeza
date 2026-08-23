#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="yan-limpeza"
APP_USER="yanapp"
APP_ROOT="/opt/yan-limpeza"
APP_HOME="/var/lib/yan-limpeza"
APP_PORT="3107"
APP_VERSION="20"
REPO_URL="https://github.com/uniquessatacado/yanlimpeza.git"
SOURCE_REF="main"
TMP_DIR="$(mktemp -d)"
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)"
RELEASE_DIR="${APP_ROOT}/releases/${RELEASE_ID}"
PREVIOUS_RELEASE=""
SWITCHED_RELEASE="0"
DEPLOY_COMMIT=""

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
  trap - ERR
  set +e
  printf '\n\033[1;31m[ERRO]\033[0m A atualização parou na linha %s.\n' "${line}" >&2
  if [[ "${SWITCHED_RELEASE}" == "1" && -n "${PREVIOUS_RELEASE}" && -d "${PREVIOUS_RELEASE}" ]]; then
    ln -sfn "${PREVIOUS_RELEASE}" "${APP_ROOT}/current.rollback"
    mv -Tf "${APP_ROOT}/current.rollback" "${APP_ROOT}/current"
    systemctl restart yan-limpeza.service || true
    printf 'A versão anterior foi restaurada automaticamente.\n' >&2
  fi
  printf 'A versão que já estava no ar foi preservada.\n' >&2
  exit 1
}

trap 'rollback $LINENO' ERR
trap cleanup EXIT

[[ "${EUID}" -eq 0 ]] || fail "Execute este comando como root."
[[ -L "${APP_ROOT}/current" && -f "${APP_ROOT}/current/package.json" ]] || fail "A instalação atual do YAN Limpeza não foi encontrada."
id "${APP_USER}" >/dev/null 2>&1 || fail "O usuário interno do aplicativo não foi encontrado."
command -v git >/dev/null 2>&1 || fail "O Git não foi encontrado no servidor."

NODE_BIN="$(command -v node || true)"
[[ -n "${NODE_BIN}" ]] || fail "O Node.js não foi encontrado."
"${NODE_BIN}" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || fail "É necessário ter o Node.js 22 ou superior."
NPM_BIN="$(command -v npm || true)"
NPM_CLI="$(readlink -f "${NPM_BIN}")"
[[ -n "${NPM_BIN}" && -f "${NPM_CLI}" ]] || fail "O npm não foi encontrado."

PREVIOUS_RELEASE="$(readlink -f "${APP_ROOT}/current")"

log "Buscando a versão mais recente no GitHub"
mkdir -p "${TMP_DIR}/source"
git -C "${TMP_DIR}/source" init -q
git -C "${TMP_DIR}/source" remote add origin "${REPO_URL}"
git -C "${TMP_DIR}/source" fetch --depth 1 origin "${SOURCE_REF}"
git -C "${TMP_DIR}/source" checkout -q --detach FETCH_HEAD
DEPLOY_COMMIT="$(git -C "${TMP_DIR}/source" rev-parse HEAD)"
printf 'Commit: %s\n' "${DEPLOY_COMMIT}"

log "Preparando a nova release"
install -d "${RELEASE_DIR}"
cp -a "${TMP_DIR}/source/." "${RELEASE_DIR}/"
rm -rf "${RELEASE_DIR}/.git"

for env_file in .env .env.local .env.production .env.production.local; do
  if [[ -f "${PREVIOUS_RELEASE}/${env_file}" ]]; then
    cp -a "${PREVIOUS_RELEASE}/${env_file}" "${RELEASE_DIR}/${env_file}"
  fi
done

chown -R "${APP_USER}:${APP_USER}" "${RELEASE_DIR}"

log "Instalando os componentes"
runuser -u "${APP_USER}" -- env HOME="${APP_HOME}" PATH="${PATH}" \
  bash -c "cd '${RELEASE_DIR}' && exec '${NODE_BIN}' '${NPM_CLI}' ci --include=dev --no-audit --no-fund"

log "Compilando a versão ${APP_VERSION}"
runuser -u "${APP_USER}" -- env HOME="${APP_HOME}" PATH="${PATH}" \
  bash -c "cd '${RELEASE_DIR}' && exec '${NODE_BIN}' '${NPM_CLI}' run build"

[[ -f "${RELEASE_DIR}/dist/server/index.js" ]] || fail "O build não gerou dist/server/index.js."
[[ -f "${RELEASE_DIR}/node_modules/vinext/dist/cli.js" ]] || fail "O inicializador do Vinext não foi instalado."

log "Ativando a nova versão"
ln -sfn "${RELEASE_DIR}" "${APP_ROOT}/current.next"
mv -Tf "${APP_ROOT}/current.next" "${APP_ROOT}/current"
SWITCHED_RELEASE="1"
systemctl restart yan-limpeza.service

ready="0"
stable_checks="0"
for _ in $(seq 1 30); do
  if systemctl is-active --quiet yan-limpeza.service; then
    main_pid="$(systemctl show -p MainPID --value yan-limpeza.service 2>/dev/null || true)"
    if [[ "${main_pid}" =~ ^[0-9]+$ ]] && [[ "${main_pid}" -gt 0 ]] && kill -0 "${main_pid}" 2>/dev/null; then
      if command -v ss >/dev/null 2>&1; then
        if ss -ltn 2>/dev/null | grep -Eq "LISTEN[[:space:]].*:${APP_PORT}([[:space:]]|$)"; then
          ready="1"
          break
        fi
      else
        stable_checks=$((stable_checks + 1))
        if [[ "${stable_checks}" -ge 3 ]]; then
          ready="1"
          break
        fi
      fi
    else
      stable_checks="0"
    fi
  else
    stable_checks="0"
  fi
  sleep 1
done

if [[ "${ready}" != "1" ]]; then
  journalctl -u yan-limpeza.service -n 100 --no-pager || true
  fail "A nova versão não iniciou corretamente."
fi

SWITCHED_RELEASE="0"
printf '\n\033[1;32mYAN Limpeza atualizado com sucesso.\033[0m\n'
printf 'Versão: %s\n' "${APP_VERSION}"
printf 'Commit: %s\n' "${DEPLOY_COMMIT}"
printf 'Release: %s\n' "${RELEASE_DIR}"
printf 'Site: https://yanlimpeza.venduss.com\n'

#!/usr/bin/env bash
# Download all configured STT model weights using huggingface_hub.
# Idempotent: existing files are skipped. Failures for one model do not stop
# the others. Reads repo / path from .env.
set -u

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
VENV_PY="${ROOT_DIR}/.venv-stt/bin/python"

if [ ! -x "${VENV_PY}" ]; then
  echo "!! Python venv not found at ${VENV_PY}. Run scripts/setup-stt-env.sh first." >&2
  exit 1
fi

# Load .env so we don't duplicate model repo names in shell.
ENV_FILE="${ROOT_DIR}/.env"
if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
else
  echo "!! ${ENV_FILE} missing. Copy .env.example to .env first." >&2
  exit 1
fi

mkdir -p "${ROOT_DIR}/models"

"${VENV_PY}" "${ROOT_DIR}/scripts/stt/download_models.py" "$@"

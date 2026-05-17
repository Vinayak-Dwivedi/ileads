#!/usr/bin/env bash
# Set up the Python venv that backs local STT.
# Safe to re-run. Does not touch the Node app or model files.
set -u

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="${ROOT_DIR}/.venv-stt"
REQ_FILE="${ROOT_DIR}/stt/requirements.txt"

echo "==> qms_demo STT venv setup"
echo "    repo:        ${ROOT_DIR}"
echo "    venv:        ${VENV_DIR}"
echo "    requirements ${REQ_FILE}"
echo
echo "==> System resources"
df -h "${ROOT_DIR}" 2>/dev/null | awk 'NR==1 || NR==2'
free -h 2>/dev/null | awk 'NR==1 || NR==2'
echo

if ! command -v python3 >/dev/null 2>&1; then
  echo "!! python3 not found on PATH. Install Python 3.10+ before re-running." >&2
  exit 1
fi

PY_VER="$(python3 -c 'import sys;print("%d.%d"%sys.version_info[:2])')"
echo "==> Using python3 (${PY_VER})"

if [ ! -d "${VENV_DIR}" ]; then
  echo "==> Creating venv at ${VENV_DIR}"
  python3 -m venv "${VENV_DIR}" || {
    echo "!! venv creation failed. Try: apt install -y python3-venv" >&2
    exit 1
  }
else
  echo "==> Reusing existing venv at ${VENV_DIR}"
fi

# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"

python -m pip install --upgrade pip wheel setuptools

# torch: try CPU wheel by default. If the user has a CUDA box they should
# re-install from https://pytorch.org/get-started/locally/ after this script.
echo "==> Installing torch + torchaudio (CPU build by default)"
if ! python -m pip install --upgrade --index-url https://download.pytorch.org/whl/cpu "torch>=2.2" "torchaudio>=2.2"; then
  echo "!! CPU torch install failed. Falling back to default PyPI torch."
  python -m pip install --upgrade "torch>=2.2" "torchaudio>=2.2" || {
    echo "!! torch install failed. STT will not run; mock mode still works." >&2
  }
fi

if [ -f "${REQ_FILE}" ]; then
  echo "==> Installing ${REQ_FILE}"
  if ! python -m pip install -r "${REQ_FILE}"; then
    echo "!! requirements install failed. STT may not work; mock mode still available." >&2
  fi
else
  echo "!! ${REQ_FILE} not found. Skipping requirements install."
fi

echo
echo "==> Torch / CUDA probe"
python - <<'PY'
import shutil

try:
    import torch
    print(f"    torch:      {torch.__version__}")
    print(f"    cuda built: {torch.version.cuda}")
    print(f"    cuda avail: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"    device:     {torch.cuda.get_device_name(0)}")
except Exception as exc:
    print(f"    torch import failed: {exc}")

for mod in ("sarvamai", "transformers", "huggingface_hub", "onnx", "onnxruntime", "faster_whisper", "ctranslate2", "soundfile", "librosa", "numpy"):
    try:
        m = __import__(mod)
        v = getattr(m, "__version__", "?")
        print(f"    {mod:18s} {v}")
    except Exception as exc:
        print(f"    {mod:18s} not installed ({exc})")

ffmpeg = shutil.which("ffmpeg")
print(f"    ffmpeg:            {ffmpeg or 'not found'}")
if ffmpeg:
    try:
        import subprocess
        proc = subprocess.run([ffmpeg, "-version"], capture_output=True, text=True, timeout=5)
        print(f"    ffmpeg version:    {proc.stdout.splitlines()[0] if proc.stdout else '?'}")
    except Exception as exc:
        print(f"    ffmpeg version:    unavailable ({exc})")
PY

echo
echo "==> Done."
echo
echo "Next steps:"
echo "  1) Download model weights:"
echo "       bash ${ROOT_DIR}/scripts/stt/download-models.sh"
echo "  2) Set MOCK_STT=false in .env to enable local STT."
echo "  3) Smoke-test:"
echo "       cd ${ROOT_DIR} && npm run smoke:stt -- --chain"
echo "  4) Restart PM2:"
echo "       pm2 restart ileads-qms --update-env"

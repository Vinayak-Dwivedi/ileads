#!/usr/bin/env python3
"""Local IndicConformer fallback STT — interface-only stub.

Same JSON contract as transcribe_indicwhisper.py. The Node adapter accepts
this script today but does NOT call it by default (STT_ENABLE_FALLBACK=false).

When IndicConformer / NeMo is ready:
  1. Install nemo_toolkit[asr] into .venv-stt.
  2. Replace the body of run_indicconformer() below.
  3. Flip STT_ENABLE_FALLBACK=true in .env.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any


def write_result(path: str | None, payload: dict[str, Any]) -> None:
    encoded = json.dumps(payload, ensure_ascii=False, indent=2)
    if path:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(encoded, encoding="utf-8")
    sys.stdout.write(encoded)
    sys.stdout.write("\n")
    sys.stdout.flush()


def fail(path: str | None, code: str, message: str, **details: Any) -> int:
    payload = {
        "error": code,
        "message": message,
        "provider": "local",
        "model": "indicconformer",
        "details": details or {},
    }
    write_result(path, payload)
    sys.stderr.write(f"[indicconformer] {code}: {message}\n")
    return 2


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="IndicConformer local STT (fallback)")
    ap.add_argument("--audio", required=True)
    ap.add_argument("--model-path", required=True)
    ap.add_argument("--language", default="hi")
    ap.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    ap.add_argument("--output", default=None)
    return ap.parse_args()


def looks_like_model_dir(model_dir: Path) -> bool:
    if not model_dir.exists() or not model_dir.is_dir():
        return False
    entries = [p for p in model_dir.iterdir() if p.name != ".gitkeep"]
    return bool(entries)


def run_indicconformer(
    audio_path: str,
    model_dir: Path,
    language: str,
    device: str,
) -> dict[str, Any]:
    # TODO: plug NeMo / IndicConformer here. Until then this stub explicitly
    # signals NOT_IMPLEMENTED so the Node fallback path stays disabled cleanly.
    raise NotImplementedError(
        "IndicConformer adapter not implemented yet. "
        "Install nemo_toolkit[asr] and wire NeMo ASRModel.restore_from() here."
    )


def main() -> int:
    args = parse_args()
    out = args.output

    if not os.path.isfile(args.audio):
        return fail(out, "AUDIO_NOT_FOUND", f"Audio file does not exist: {args.audio}")

    model_dir = Path(args.model_path)
    if not looks_like_model_dir(model_dir):
        return fail(
            out,
            "MODEL_NOT_FOUND",
            f"IndicConformer model directory is empty: {model_dir}",
            model_path=str(model_dir),
        )

    started = time.monotonic()
    try:
        result = run_indicconformer(args.audio, model_dir, args.language, args.device)
    except NotImplementedError as exc:
        return fail(out, "NOT_IMPLEMENTED", str(exc))
    except ModuleNotFoundError as exc:
        return fail(out, "DEPENDENCY_MISSING", str(exc))
    except Exception as exc:  # noqa: BLE001
        return fail(
            out,
            "TRANSCRIBE_FAILED",
            f"{type(exc).__name__}: {exc}",
            traceback=traceback.format_exc(limit=4),
        )

    result.setdefault("raw", {})["elapsed_seconds"] = round(time.monotonic() - started, 3)
    write_result(out, result)
    return 0


if __name__ == "__main__":
    sys.exit(main())

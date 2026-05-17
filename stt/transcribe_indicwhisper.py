#!/usr/bin/env python3
"""Local IndicWhisper transcription.

Invocation contract (called from Node via child_process):

    python transcribe_indicwhisper.py \
        --audio /path/to/audio.wav \
        --model-path /root/qms_demo/models/indicwhisper \
        --language hi \
        --device auto \
        --output /tmp/stt-output.json

On success: writes the JSON contract documented in stt/README.md to --output
(and a compact mirror to stdout) and exits 0.

On any failure: writes a JSON error envelope to --output and stderr, and exits
non-zero. The Node adapter only trusts a zero exit + a parseable JSON result;
anything else is surfaced to the UI as "local STT failed, mock still works".

This script never raises uncaught exceptions to stderr — every failure path
returns a structured error so the calling Node service can act on it.
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
    # Mirror to stdout so callers without a file path can still read it.
    sys.stdout.write(encoded)
    sys.stdout.write("\n")
    sys.stdout.flush()


def fail(path: str | None, code: str, message: str, **details: Any) -> int:
    payload = {
        "error": code,
        "message": message,
        "provider": "local",
        "model": "indicwhisper",
        "details": details or {},
    }
    write_result(path, payload)
    sys.stderr.write(f"[indicwhisper] {code}: {message}\n")
    return 2


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="IndicWhisper local STT")
    ap.add_argument("--audio", required=True, help="Absolute path to audio file")
    ap.add_argument("--model-path", required=True, help="Path to IndicWhisper model directory")
    ap.add_argument("--language", default="hi", help="Language code (default: hi)")
    ap.add_argument(
        "--device",
        default="auto",
        choices=["auto", "cpu", "cuda"],
        help="Inference device",
    )
    ap.add_argument("--compute-type", default=None, help="faster-whisper compute_type override")
    ap.add_argument("--beam-size", type=int, default=5)
    ap.add_argument("--output", default=None, help="Write JSON to this file (also stdout)")
    return ap.parse_args()


def resolve_device(requested: str) -> str:
    if requested in ("cpu", "cuda"):
        return requested
    try:
        import torch  # type: ignore

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def looks_like_model_dir(model_dir: Path) -> bool:
    """A best-effort sniff for whether the model dir is populated.

    Empty directory or only a .gitkeep counts as "no model".
    """
    if not model_dir.exists() or not model_dir.is_dir():
        return False
    entries = [p for p in model_dir.iterdir() if p.name != ".gitkeep"]
    if not entries:
        return False
    # CTranslate2 / faster-whisper layout
    if (model_dir / "model.bin").exists():
        return True
    # HuggingFace transformers layout
    if any((model_dir / name).exists() for name in ("config.json", "tokenizer.json", "model.safetensors", "pytorch_model.bin")):
        return True
    # Generic checkpoint
    return any(p.is_file() for p in entries)


def run_faster_whisper(
    audio_path: str,
    model_dir: Path,
    language: str,
    device: str,
    compute_type: str | None,
    beam_size: int,
) -> dict[str, Any]:
    """Run faster-whisper against the model directory.

    Raises on any error — the caller wraps with a JSON error envelope.
    """
    from faster_whisper import WhisperModel  # type: ignore

    if compute_type is None:
        compute_type = "float16" if device == "cuda" else "int8"

    model = WhisperModel(str(model_dir), device=device, compute_type=compute_type)
    segments_iter, info = model.transcribe(
        audio_path,
        language=language or None,
        beam_size=beam_size,
        vad_filter=False,
        word_timestamps=False,
    )

    out_segments: list[dict[str, Any]] = []
    for idx, seg in enumerate(segments_iter, start=1):
        # avg_logprob is in log space; map roughly to (0, 1] via exp().
        confidence: float | None
        try:
            import math

            confidence = float(math.exp(seg.avg_logprob)) if seg.avg_logprob is not None else None
        except Exception:
            confidence = None
        out_segments.append(
            {
                "segment_id": f"seg_{idx:04d}",
                "start_time": float(seg.start) if seg.start is not None else 0.0,
                "end_time": float(seg.end) if seg.end is not None else 0.0,
                "speaker": None,
                "text": (seg.text or "").strip(),
                "confidence": confidence,
                "language": getattr(info, "language", language) or language,
                "model": "indicwhisper",
                "raw": {
                    "avg_logprob": getattr(seg, "avg_logprob", None),
                    "no_speech_prob": getattr(seg, "no_speech_prob", None),
                    "compression_ratio": getattr(seg, "compression_ratio", None),
                },
            }
        )

    return {
        "provider": "local",
        "model": "indicwhisper",
        "language": getattr(info, "language", language) or language,
        "segments": out_segments,
        "raw": {
            "backend": "faster-whisper",
            "device": device,
            "compute_type": compute_type,
            "duration": getattr(info, "duration", None),
            "language_probability": getattr(info, "language_probability", None),
        },
    }


def main() -> int:
    args = parse_args()
    out = args.output

    audio_path = args.audio
    if not os.path.isfile(audio_path):
        return fail(out, "AUDIO_NOT_FOUND", f"Audio file does not exist: {audio_path}")

    model_dir = Path(args.model_path)
    if not looks_like_model_dir(model_dir):
        return fail(
            out,
            "MODEL_NOT_FOUND",
            (
                "IndicWhisper model directory is empty. Drop model files into "
                f"{model_dir} (e.g. CTranslate2 'model.bin' + tokenizer files, "
                "or a HuggingFace checkpoint)."
            ),
            model_path=str(model_dir),
        )

    device = resolve_device(args.device)

    # TODO: when an official IndicWhisper package is wired, branch on its
    # presence here instead of going straight to faster-whisper. Both backends
    # should produce the same JSON shape so the Node adapter is unaffected.

    started = time.monotonic()
    try:
        result = run_faster_whisper(
            audio_path=audio_path,
            model_dir=model_dir,
            language=args.language,
            device=device,
            compute_type=args.compute_type,
            beam_size=args.beam_size,
        )
    except ModuleNotFoundError as exc:
        return fail(
            out,
            "DEPENDENCY_MISSING",
            (
                "Python STT dependencies are not installed. Run "
                "`bash scripts/setup-stt-env.sh` and retry."
            ),
            missing=str(exc),
        )
    except FileNotFoundError as exc:
        return fail(out, "MODEL_FILE_MISSING", str(exc), model_path=str(model_dir))
    except Exception as exc:  # noqa: BLE001
        return fail(
            out,
            "TRANSCRIBE_FAILED",
            f"{type(exc).__name__}: {exc}",
            traceback=traceback.format_exc(limit=4),
        )

    result["raw"]["elapsed_seconds"] = round(time.monotonic() - started, 3)
    write_result(out, result)
    return 0


if __name__ == "__main__":
    sys.exit(main())

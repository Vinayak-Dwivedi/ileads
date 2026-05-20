#!/usr/bin/env python3
"""Unified local STT entrypoint for the QMS Node app.

Usage (from Node child_process):

    python stt/transcribe.py \
        --audio /abs/path/audio.wav \
        --model-key indicconformer \
        --model-path /root/qms_demo/models/indicconformer-600m \
        --language hi \
        --device auto \
        --output /tmp/stt-output.json

Supported model keys:
    - indicconformer            (AI4Bharat IndicConformer 600M, HF Transformers AutoModel)
    - faster-whisper-small      (CTranslate2 small via faster-whisper)
    - faster-whisper-base       (CTranslate2 base via faster-whisper)

Audio is auto-resampled to 16 kHz mono via ffmpeg before being handed to the
backend. Long audio is chunked at STT_CHUNK_SECONDS (CLI override available).

JSON contract (success):
{
  "provider": "local",
  "model": "<model-key>",
  "language": "hi",
  "segments": [
    {"segment_id":"seg_0001","start_time":0.0,"end_time":5.2,"speaker":null,
     "text":"...","confidence":null,"language":"hi","model":"<model-key>","raw":{}}
  ],
  "raw": {...}
}

JSON contract (failure):
{"error":"CODE","message":"...","provider":"local","model":"<model-key>","details":{...}}
and non-zero exit code.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Iterable, List

# Force UTF-8 on Windows stdout/stderr to prevent UnicodeEncodeError with Indian language transcripts
if sys.platform.startswith("win"):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")


SAMPLE_RATE = 16000


# ----------------------------- I/O helpers -----------------------------------

def log(msg: str) -> None:
    sys.stderr.write(f"[stt] {msg}\n")
    sys.stderr.flush()


def write_result(path: str | None, payload: dict[str, Any]) -> None:
    encoded = json.dumps(payload, ensure_ascii=False, indent=2)
    if path:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(encoded, encoding="utf-8")
    sys.stdout.write(encoded)
    sys.stdout.write("\n")
    sys.stdout.flush()


def fail(path: str | None, model_key: str, code: str, message: str, **details: Any) -> int:
    write_result(
        path,
        {
            "error": code,
            "message": message,
            "provider": "local",
            "model": model_key,
            "details": details or {},
        },
    )
    log(f"FAIL [{code}] {message}")
    return 2


# ----------------------------- Audio helpers ---------------------------------

def ensure_wav_16k_mono(src: str, tmp_dir: str) -> str:
    """Convert any input file to a 16kHz mono WAV via ffmpeg.

    Returns the path to the converted file. If ffmpeg is missing, raises
    FileNotFoundError so the caller can produce a structured error.
    """
    # Quick check: if it's already a 16k mono wav, ffprobe-free heuristic is
    # not worth the risk of accepting a wrong-format file. Always convert.
    out_path = os.path.join(tmp_dir, "audio_16k_mono.wav")
    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-i",
        src,
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-vn",
        out_path,
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed (exit {proc.returncode}): {proc.stderr.decode('utf-8', 'replace')[:500]}"
        )
    return out_path


def env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_speaker(name: str, default: str) -> str:
    value = os.environ.get(name, default).strip().lower()
    return value if value in {"agent", "customer", "unknown"} else default


def ffprobe_channels(src: str) -> int:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=channels",
        "-of",
        "default=nokey=1:noprint_wrappers=1",
        src,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return 1
    try:
        return max(1, int(proc.stdout.strip().splitlines()[0]))
    except Exception:
        return 1


def audio_filter(base: str | None = None) -> str:
    filters: list[str] = []
    if base:
        filters.append(base)
    if env_bool("STT_AUDIO_DENOISE_LIGHT", True):
        filters.extend(["highpass=f=80", "lowpass=f=7600"])
    if env_bool("STT_AUDIO_NORMALIZE", True):
        filters.append("dynaudnorm=f=150:g=15")
    return ",".join(filters)


def preprocess_audio_variants(src: str, tmp_dir: str) -> list[dict[str, Any]]:
    """Return one or two 16 kHz mono WAV variants with channel/speaker metadata."""
    preprocess = env_bool("STT_PREPROCESS_AUDIO", True)
    split_stereo = env_bool("STT_SPLIT_STEREO_CHANNELS", True)
    channels = ffprobe_channels(src)

    if preprocess and split_stereo and channels >= 2:
        variants: list[dict[str, Any]] = []
        specs = [
            ("left", "c0=c0", env_speaker("STT_STEREO_LEFT_SPEAKER", "agent")),
            ("right", "c0=c1", env_speaker("STT_STEREO_RIGHT_SPEAKER", "customer")),
        ]
        for channel, pan, speaker in specs:
            out_path = os.path.join(tmp_dir, f"audio_{channel}_16k.wav")
            filters = audio_filter(f"pan=mono|{pan}")
            cmd = [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                src,
                "-map",
                "0:a:0",
                "-ac",
                "1",
                "-ar",
                str(SAMPLE_RATE),
                "-vn",
                out_path,
            ]
            if filters:
                cmd[-2:-2] = ["-af", filters]
            proc = subprocess.run(cmd, capture_output=True)
            if proc.returncode != 0:
                raise RuntimeError(
                    f"ffmpeg channel split failed (exit {proc.returncode}): {proc.stderr.decode('utf-8', 'replace')[:500]}"
                )
            variants.append(
                {
                    "path": out_path,
                    "channel": channel,
                    "speaker": speaker,
                    "speaker_source": "stereo_channel",
                }
            )
        return variants

    if preprocess:
        out_path = os.path.join(tmp_dir, "audio_mono_16k.wav")
        filters = audio_filter()
        cmd = [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            src,
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-vn",
            out_path,
        ]
        if filters:
            cmd[-2:-2] = ["-af", filters]
        proc = subprocess.run(cmd, capture_output=True)
        if proc.returncode != 0:
            raise RuntimeError(
                f"ffmpeg preprocess failed (exit {proc.returncode}): {proc.stderr.decode('utf-8', 'replace')[:500]}"
            )
    else:
        out_path = ensure_wav_16k_mono(src, tmp_dir)

    return [
        {
            "path": out_path,
            "channel": "mono",
            "speaker": None,
            "speaker_source": "heuristic",
        }
    ]


def load_wav_float32(path: str) -> "tuple[Any, int]":
    import soundfile as sf  # type: ignore
    import numpy as np  # type: ignore

    data, sr = sf.read(path, dtype="float32", always_2d=False)
    if data.ndim == 2:
        data = data.mean(axis=1)
    if sr != SAMPLE_RATE:
        import librosa  # type: ignore

        data = librosa.resample(data, orig_sr=sr, target_sr=SAMPLE_RATE)
        sr = SAMPLE_RATE
    return data.astype("float32"), sr


def iter_chunks(data: Any, sr: int, chunk_seconds: float, overlap_seconds: float) -> Iterable[tuple[float, float, Any]]:
    """Yield (start_sec, end_sec, samples) chunks with optional overlap."""
    import numpy as np  # type: ignore

    if chunk_seconds <= 0:
        yield 0.0, len(data) / sr, data
        return
    step = int(chunk_seconds * sr)
    overlap = max(0, int(overlap_seconds * sr))
    advance = max(1, step - min(overlap, step - 1))
    if step <= 0:
        yield 0.0, len(data) / sr, data
        return
    for i in range(0, len(data), advance):
        chunk = data[i : i + step]
        if len(chunk) == 0:
            continue
        start = i / sr
        end = (i + len(chunk)) / sr
        yield start, end, chunk


def resolve_device(requested: str) -> str:
    if requested in ("cpu", "cuda"):
        return requested
    try:
        import torch  # type: ignore

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def looks_populated(model_dir: Path) -> bool:
    if not model_dir.exists() or not model_dir.is_dir():
        return False
    entries = {p.name for p in model_dir.iterdir() if p.name != ".gitkeep"}
    return bool(entries) and ("config.json" in entries or "model.bin" in entries)


# ----------------------------- Backends --------------------------------------

def run_indicconformer(
    audio_wav: str,
    model_dir: Path,
    language: str,
    device: str,
    chunk_seconds: float,
    chunk_overlap_seconds: float,
) -> dict[str, Any]:
    """AI4Bharat IndicConformer 600M (HF Transformers AutoModel, trust_remote_code).

    The official model card uses ``AutoModel.from_pretrained(..., trust_remote_code=True)``
    and exposes ``model(wav, lang_id, decoding)`` returning a string.
    """
    import numpy as np  # type: ignore
    import torch  # type: ignore

    log(f"loading IndicConformer from {model_dir} (device={device})")
    custom_code = model_dir / "model_onnx.py"
    if not custom_code.is_file():
        raise FileNotFoundError(f"IndicConformer custom code missing: {custom_code}")

    spec = importlib.util.spec_from_file_location("qms_indicconformer_model_onnx", custom_code)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load IndicConformer custom code: {custom_code}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    config_path = model_dir / "config.json"
    config_data: dict[str, Any] = {}
    if config_path.is_file():
        config_data = json.loads(config_path.read_text(encoding="utf-8"))
    for ignored_key in ("auto_map", "architectures", "model_type"):
        config_data.pop(ignored_key, None)

    config = module.IndicASRConfig(ts_folder=str(model_dir), **config_data)
    model = module.IndicASRModel(config)
    if device == "cuda":
        try:
            model = model.cuda()
        except Exception as exc:
            log(f"cuda move failed, falling back to cpu: {exc}")
            device = "cpu"

    data, sr = load_wav_float32(audio_wav)
    log(f"audio loaded: {len(data)/sr:.2f}s @ {sr}Hz")

    out_segments: list[dict[str, Any]] = []
    started = time.monotonic()

    for idx, (start_s, end_s, chunk) in enumerate(iter_chunks(data, sr, chunk_seconds, chunk_overlap_seconds), start=1):
        wav_tensor = torch.from_numpy(np.asarray(chunk, dtype="float32")).unsqueeze(0)
        if device == "cuda":
            wav_tensor = wav_tensor.cuda()
        try:
            # AI4Bharat IndicConformer expects: model(wav, "<lang>", "ctc"|"rnnt")
            text = model(wav_tensor, language, "ctc")
        except TypeError:
            # Some versions expose .transcribe()
            text = model.transcribe(wav_tensor, language=language)
        except Exception as exc:
            raise RuntimeError(f"IndicConformer inference error on chunk {idx}: {exc}") from exc
        if isinstance(text, (list, tuple)) and text:
            text = text[0]
        text = (text or "").strip() if isinstance(text, str) else str(text).strip()
        out_segments.append(
            {
                "segment_id": f"seg_{idx:04d}",
                "start_time": round(start_s, 3),
                "end_time": round(end_s, 3),
                "speaker": None,
                "text": text,
                "confidence": None,
                "language": language,
                "model": "indicconformer",
                "raw": {"chunk_seconds": chunk_seconds},
            }
        )

    return {
        "provider": "local",
        "model": "indicconformer",
        "language": language,
        "segments": out_segments,
        "raw": {
            "backend": "transformers-automodel",
            "device": device,
            "duration": len(data) / sr,
            "elapsed_seconds": round(time.monotonic() - started, 3),
        },
    }


def run_faster_whisper(
    audio_wav: str,
    model_dir: Path,
    language: str,
    device: str,
    chunk_seconds: float,
    chunk_overlap_seconds: float,
    model_key: str,
) -> dict[str, Any]:
    """faster-whisper CTranslate2 backend for configured small/base models."""
    from faster_whisper import WhisperModel  # type: ignore

    compute_type = "float16" if device == "cuda" else "int8"
    log(f"loading {model_key} from {model_dir} (device={device}, compute={compute_type})")
    model = WhisperModel(str(model_dir), device=device, compute_type=compute_type)
    started = time.monotonic()
    seg_iter, info = model.transcribe(
        audio_wav,
        language=language or None,
        beam_size=5,
        task="transcribe",
        vad_filter=False,
    )
    out_segments: list[dict[str, Any]] = []
    for idx, seg in enumerate(seg_iter, start=1):
        try:
            confidence = float(math.exp(seg.avg_logprob)) if seg.avg_logprob is not None else None
        except Exception:
            confidence = None
        out_segments.append(
            {
                "segment_id": f"seg_{idx:04d}",
                "start_time": round(float(seg.start or 0.0), 3),
                "end_time": round(float(seg.end or 0.0), 3),
                "speaker": None,
                "text": (seg.text or "").strip(),
                "confidence": confidence,
                "language": getattr(info, "language", language) or language,
                "model": model_key,
                "raw": {
                    "avg_logprob": getattr(seg, "avg_logprob", None),
                    "no_speech_prob": getattr(seg, "no_speech_prob", None),
                },
            }
        )

    return {
        "provider": "local",
        "model": model_key,
        "language": getattr(info, "language", language) or language,
        "segments": out_segments,
        "raw": {
            "backend": "faster-whisper",
            "device": device,
            "compute_type": compute_type,
            "duration": getattr(info, "duration", None),
            "language_probability": getattr(info, "language_probability", None),
            "elapsed_seconds": round(time.monotonic() - started, 3),
        },
    }


BACKENDS = {
    "indicconformer": run_indicconformer,
    "faster-whisper-small": run_faster_whisper,
    "faster-whisper-base": run_faster_whisper,
}


# ----------------------------- CLI -------------------------------------------

def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Unified local STT entrypoint")
    ap.add_argument("--audio", required=True)
    ap.add_argument("--model-key", required=True, choices=sorted(BACKENDS.keys()))
    ap.add_argument("--model-path", required=True)
    ap.add_argument("--language", default="hi")
    ap.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    ap.add_argument("--chunk-seconds", type=float, default=30.0)
    ap.add_argument("--chunk-overlap-seconds", type=float, default=0.0)
    ap.add_argument("--output", default=None)
    return ap.parse_args()


def apply_speaker_metadata(
    result: dict[str, Any],
    *,
    channel: str | None,
    fixed_speaker: str | None,
    speaker_source: str,
) -> dict[str, Any]:
    first = env_speaker("STT_MONO_FIRST_SPEAKER", "agent")
    second = "customer" if first == "agent" else "agent"
    segments = result.get("segments") if isinstance(result.get("segments"), list) else []
    for idx, seg in enumerate(segments):
        if fixed_speaker:
            speaker = fixed_speaker
            source = speaker_source
        else:
            speaker = first if idx % 2 == 0 else second
            source = "heuristic"
        seg["speaker"] = speaker
        seg["channel"] = channel
        seg["speaker_source"] = source
        raw = seg.get("raw") if isinstance(seg.get("raw"), dict) else {}
        raw["speaker_source"] = source
        if source == "heuristic":
            raw["diarization_confidence"] = "low"
        seg["raw"] = raw
    return result


def merge_variant_results(results: list[dict[str, Any]], model_key: str, language: str) -> dict[str, Any]:
    merged_segments: list[dict[str, Any]] = []
    raw_variants = []
    for result in results:
        merged_segments.extend(result.get("segments", []))
        raw_variants.append(result.get("raw", {}))
    merged_segments.sort(key=lambda s: (float(s.get("start_time") or 0), str(s.get("channel") or "")))
    for idx, seg in enumerate(merged_segments, start=1):
        seg["segment_id"] = f"seg_{idx:04d}"
    return {
        "provider": "local",
        "model": model_key,
        "language": language,
        "segments": merged_segments,
        "raw": {
            "variants": raw_variants,
            "speaker_labeling": "stereo_channel" if len(results) > 1 else "heuristic",
        },
    }


def main() -> int:
    args = parse_args()
    out = args.output
    key = args.model_key

    if not os.path.isfile(args.audio):
        return fail(out, key, "AUDIO_NOT_FOUND", f"Audio file does not exist: {args.audio}")

    model_dir = Path(args.model_path)
    if not looks_populated(model_dir):
        return fail(
            out,
            key,
            "MODEL_NOT_FOUND",
            f"Model directory is empty: {model_dir}. Run scripts/stt/download-models.sh.",
            model_path=str(model_dir),
        )

    device = resolve_device(args.device)
    backend = BACKENDS[key]

    runtime_dir = Path(os.environ.get("STT_RUNTIME_DIR", "") or tempfile.gettempdir())
    runtime_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="qms-stt-", dir=str(runtime_dir)) as tmp_dir:
        try:
            variants = preprocess_audio_variants(args.audio, tmp_dir)
        except FileNotFoundError:
            return fail(out, key, "FFMPEG_MISSING", "ffmpeg/ffprobe are required. apt install -y ffmpeg.")
        except Exception as exc:
            return fail(out, key, "AUDIO_PREPROCESS_FAILED", str(exc))

        try:
            variant_results: list[dict[str, Any]] = []
            for variant in variants:
                if key.startswith("faster-whisper-"):
                    result = backend(
                        audio_wav=variant["path"],
                        model_dir=model_dir,
                        language=args.language,
                        device=device,
                        chunk_seconds=args.chunk_seconds,
                        chunk_overlap_seconds=args.chunk_overlap_seconds,
                        model_key=key,
                    )
                else:
                    result = backend(
                        audio_wav=variant["path"],
                        model_dir=model_dir,
                        language=args.language,
                        device=device,
                        chunk_seconds=args.chunk_seconds,
                        chunk_overlap_seconds=args.chunk_overlap_seconds,
                    )
                variant_results.append(
                    apply_speaker_metadata(
                        result,
                        channel=variant.get("channel"),
                        fixed_speaker=variant.get("speaker"),
                        speaker_source=variant.get("speaker_source", "unknown"),
                    )
                )
            result = merge_variant_results(variant_results, key, args.language)
        except ModuleNotFoundError as exc:
            return fail(out, key, "DEPENDENCY_MISSING", f"Missing Python dep: {exc}")
        except FileNotFoundError as exc:
            return fail(out, key, "MODEL_FILE_MISSING", str(exc), model_path=str(model_dir))
        except Exception as exc:  # noqa: BLE001
            return fail(
                out,
                key,
                "TRANSCRIBE_FAILED",
                f"{type(exc).__name__}: {exc}",
                error_type=type(exc).__name__,
            )

    write_result(out, result)
    return 0


if __name__ == "__main__":
    sys.exit(main())

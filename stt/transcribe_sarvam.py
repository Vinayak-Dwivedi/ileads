#!/usr/bin/env python3
"""Sarvam Saaras STT adapter for the QMS Node app.

This script intentionally emits the same JSON contract as stt/transcribe.py so
the Node side can swap providers without changing transcript persistence.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import tempfile
from pathlib import Path
from typing import Any

# Force UTF-8 on Windows stdout/stderr to prevent UnicodeEncodeError with Indian language transcripts
if sys.platform.startswith("win"):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")



def write_result(path: str | None, payload: dict[str, Any]) -> None:
    encoded = json.dumps(payload, ensure_ascii=False, indent=2)
    if path:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(encoded, encoding="utf-8")
    sys.stdout.write(encoded + "\n")
    sys.stdout.flush()


def fail(path: str | None, model: str, code: str, message: str, **details: Any) -> int:
    write_result(
        path,
        {
            "error": code,
            "message": message,
            "provider": "sarvam",
            "model": model,
            "details": details or {},
        },
    )
    return 2


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Sarvam Saaras STT adapter")
    ap.add_argument("--audio", required=True)
    ap.add_argument("--api-key", required=False, default="")
    ap.add_argument("--model", default="saaras:v3")
    ap.add_argument("--mode", default="transcribe")
    ap.add_argument("--use-batch", default="false")
    ap.add_argument("--enable-diarization", default="true")
    ap.add_argument("--poll-interval-seconds", type=int, default=10)
    ap.add_argument("--batch-timeout-seconds", type=int, default=900)
    ap.add_argument("--output", default=None)
    return ap.parse_args()


def arg_bool(value: str | bool | None, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    raw = str(value).strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    return default


def serialize_response(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        return [serialize_response(item) for item in value]
    if isinstance(value, tuple):
        return [serialize_response(item) for item in value]
    if isinstance(value, dict):
        return {str(k): serialize_response(v) for k, v in value.items()}
    for attr in ("model_dump", "dict", "to_dict"):
        fn = getattr(value, attr, None)
        if callable(fn):
            try:
                return serialize_response(fn())
            except Exception:
                pass
    if hasattr(value, "__dict__"):
        return {
            k: serialize_response(v)
            for k, v in vars(value).items()
            if not k.startswith("_")
        }
    return str(value)


def pick_text(payload: Any) -> str:
    if isinstance(payload, str):
        return payload.strip()
    if isinstance(payload, dict):
        for key in ("transcript", "text", "transcribed_text"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        for key in ("data", "result", "response", "output"):
            text = pick_text(payload.get(key))
            if text:
                return text
    return ""


def get_number(payload: dict[str, Any], keys: tuple[str, ...]) -> float | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, (int, float)):
            return float(value)
    return None


def normalize_speaker(value: Any) -> tuple[str, str | None, str]:
    raw = str(value or "").strip().lower()
    map_speakers = arg_bool(os.environ.get("SARVAM_MAP_SPEAKERS_TO_AGENT_CUSTOMER"), True)
    first = os.environ.get("SARVAM_FIRST_SPEAKER", "agent").strip().lower()
    second = os.environ.get("SARVAM_SECOND_SPEAKER", "customer").strip().lower()
    first = first if first in {"agent", "customer", "unknown"} else "agent"
    second = second if second in {"agent", "customer", "unknown"} else "customer"

    first_labels = {"speaker_0", "speaker 0", "spk_0", "speaker0", "0", "a"}
    second_labels = {"speaker_1", "speaker 1", "spk_1", "speaker1", "1", "b"}
    if raw in {"agent", "customer", "system"}:
        return raw, raw or None, "sarvam_diarization"
    if map_speakers and raw in first_labels:
        return first, raw, "sarvam_diarization_mapped"
    if map_speakers and raw in second_labels:
        return second, raw, "sarvam_diarization_mapped"
    if raw:
        return "unknown", raw, "sarvam_diarization"
    return "unknown", None, "sarvam_no_diarization"


def find_segment_list(payload: Any) -> list[Any]:
    if not isinstance(payload, dict):
        return []
    for key in ("segments", "utterances", "diarized_transcript", "timestamps", "words"):
        value = payload.get(key)
        if isinstance(value, list) and value:
            return value
        if isinstance(value, dict):
            for nested_key in ("entries", "segments", "utterances", "words"):
                nested = value.get(nested_key)
                if isinstance(nested, list) and nested:
                    return nested
    for key in ("data", "result", "response", "output"):
        nested = find_segment_list(payload.get(key))
        if nested:
            return nested
    return []


def map_segments(payload: dict[str, Any], model: str) -> list[dict[str, Any]]:
    raw_segments = find_segment_list(payload)
    segments: list[dict[str, Any]] = []
    for idx, item in enumerate(raw_segments, start=1):
        if not isinstance(item, dict):
            continue
        text = pick_text(item)
        if not text:
            continue
        start = get_number(item, ("start_time", "start", "start_sec", "start_seconds", "start_time_seconds"))
        end = get_number(item, ("end_time", "end", "end_sec", "end_seconds", "end_time_seconds"))
        speaker_value = (
            item.get("speaker")
            or item.get("speaker_id")
            or item.get("speaker_label")
            or item.get("speaker_tag")
        )
        speaker, raw_speaker, speaker_source = normalize_speaker(speaker_value)
        segments.append(
            {
                "segment_id": f"seg_{idx:03d}",
                "start_time": start if start is not None else 0.0,
                "end_time": end,
                "speaker": speaker,
                "text": text,
                "confidence": item.get("confidence"),
                "language": item.get("language"),
                "model": model,
                "channel": raw_speaker,
                "speaker_source": speaker_source,
                "raw": item,
            }
        )
    return segments


def run_simple(args: argparse.Namespace, api_key: str) -> dict[str, Any]:
    from sarvamai import SarvamAI  # type: ignore

    client = SarvamAI(api_subscription_key=api_key)
    with open(args.audio, "rb") as audio_file:
        return serialize_response(
            client.speech_to_text.transcribe(
                file=audio_file,
                model=args.model,
                mode=args.mode,
            )
        )


def load_batch_output(output_dir: str) -> dict[str, Any]:
    candidates = sorted(Path(output_dir).glob("*.json"))
    if not candidates:
        raise RuntimeError("Sarvam batch completed but no JSON output file was downloaded.")
    return json.loads(candidates[0].read_text(encoding="utf-8"))


def wait_for_batch_job(job: Any, poll_interval: int, timeout: int) -> Any:
    started = time.monotonic()
    interval = max(1, poll_interval)
    limit = max(30, timeout)
    last_state = ""
    while True:
        status = job.get_status()
        state = str(getattr(status, "job_state", "") or "").lower()
        if state != last_state:
            print(f"[sarvam-batch] job={job.job_id} state={state or 'unknown'}", file=sys.stderr, flush=True)
            last_state = state
        if state in {"completed", "failed"}:
            return status
        if time.monotonic() - started > limit:
            raise TimeoutError(f"Job {job.job_id} did not complete within {limit} seconds.")
        time.sleep(interval)


def run_batch(args: argparse.Namespace, api_key: str) -> dict[str, Any]:
    from sarvamai import SarvamAI  # type: ignore

    client = SarvamAI(api_subscription_key=api_key)
    job = client.speech_to_text_job.create_job(
        model=args.model,
        mode=args.mode,
        with_diarization=arg_bool(args.enable_diarization, True),
        with_timestamps=True,
        num_speakers=2,
    )
    upload_ok = job.upload_files([args.audio], timeout=120)
    if not upload_ok:
        raise RuntimeError("Sarvam batch upload failed.")
    print(f"[sarvam-batch] job={job.job_id} uploaded", file=sys.stderr, flush=True)
    job.start()
    print(f"[sarvam-batch] job={job.job_id} started", file=sys.stderr, flush=True)
    status = wait_for_batch_job(job, args.poll_interval_seconds, args.batch_timeout_seconds)
    if str(getattr(status, "job_state", "")).lower() == "failed":
        raise RuntimeError("Sarvam batch job failed.")
    with tempfile.TemporaryDirectory(prefix="sarvam-batch-out-") as output_dir:
        job.download_outputs(output_dir)
        output = load_batch_output(output_dir)
    return {
        "job_id": job.job_id,
        "status": serialize_response(status),
        "output": serialize_response(output),
    }


def main() -> int:
    args = parse_args()
    out = args.output
    api_key = args.api_key or os.environ.get("SARVAM_API_KEY", "")
    if not api_key.strip():
        return fail(out, args.model, "SARVAM_API_KEY_MISSING", "Sarvam API key missing.")
    if not os.path.isfile(args.audio):
        return fail(out, args.model, "AUDIO_NOT_FOUND", f"Audio file does not exist: {args.audio}")

    try:
        from sarvamai import SarvamAI  # noqa: F401  # type: ignore
    except Exception as exc:
        return fail(out, args.model, "DEPENDENCY_MISSING", f"Missing sarvamai dependency: {type(exc).__name__}")

    started = time.monotonic()
    try:
        raw = run_batch(args, api_key) if arg_bool(args.use_batch) else run_simple(args, api_key)
    except TimeoutError as exc:
        return fail(
            out,
            args.model,
            "SARVAM_TIMEOUT",
            "Sarvam transcription timed out. Please retry or use a shorter audio file.",
            error_type=type(exc).__name__,
        )
    except Exception as exc:
        name = type(exc).__name__
        message = str(exc).lower()
        if "batch job failed" in message:
            code = "SARVAM_BATCH_FAILED"
        else:
            code = "SARVAM_HTTP_ERROR" if "http" in name.lower() or "api" in name.lower() else "SARVAM_TRANSCRIBE_FAILED"
        return fail(out, args.model, code, f"Sarvam transcription failed: {name}", error_type=name)

    if not isinstance(raw, dict):
        raw = {"response": raw}

    payload = raw.get("output") if arg_bool(args.use_batch) and isinstance(raw.get("output"), dict) else raw
    segments = map_segments(payload, args.model)
    text = pick_text(payload)
    if not segments and text:
        segments = [
            {
                "segment_id": "seg_001",
                "start_time": 0.0,
                "end_time": None,
                "speaker": "unknown",
                "text": text,
                "confidence": None,
                "language": raw.get("language"),
                "model": args.model,
                "channel": None,
                "speaker_source": "sarvam_no_diarization",
                "raw": {},
            }
        ]

    full_text = text or " ".join(seg["text"] for seg in segments).strip()
    if not full_text:
        return fail(out, args.model, "SARVAM_INVALID_RESPONSE", "Sarvam response did not contain usable transcript text.")

    write_result(
        out,
        {
            "provider": "sarvam",
            "model": args.model,
            "language": raw.get("language") or "auto",
            "segments": segments,
            "raw": {
                "mode": args.mode,
                "use_batch": arg_bool(args.use_batch),
                "elapsed_seconds": round(time.monotonic() - started, 3),
                "response": raw,
            },
        },
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

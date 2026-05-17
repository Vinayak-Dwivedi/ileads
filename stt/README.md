# Local STT (Python subprocess)

Node calls `transcribe.py` as a one-shot subprocess. It reads an audio file,
runs the named model, and writes a JSON file. Node parses that JSON and
persists the transcript.

## Layout

```
stt/
  requirements.txt              Python deps (best-effort; CPU/GPU agnostic)
  transcribe.py                 Unified entrypoint (use this from Node)
  transcribe_indicwhisper.py    Legacy single-model script (kept for parity)
  transcribe_indicconformer.py  Legacy single-model script
  README.md
```

## Setup

```bash
bash scripts/setup-stt-env.sh
```

Creates `/root/qms_demo/.venv-stt`, installs torch (CPU wheel by default) plus
`requirements.txt`, prints CUDA availability and key dep versions.

## Model files

Weights go here:

```
/root/qms_demo/models/indicconformer-600m       (primary, gated)
/root/qms_demo/models/faster-whisper-small      (fallback)
```

Use the downloader:

```bash
HF_TOKEN="hf_..." bash scripts/stt/download-models.sh
```

A failed model is reported but does not stop the others. Without weights the
script returns `MODEL_NOT_FOUND` cleanly and exits non-zero.

## CLI contract

```bash
/root/qms_demo/.venv-stt/bin/python \
  /root/qms_demo/stt/transcribe.py \
  --audio /root/qms_demo/storage/audio/<file>.wav \
  --model-key faster-whisper-small \
  --model-path /root/qms_demo/models/faster-whisper-small \
  --language hi \
  --device auto \
  --chunk-seconds 30 \
  --output /tmp/stt-output.json
```

Supported `--model-key`:

- `indicconformer` — HF Transformers `AutoModel.from_pretrained(..., trust_remote_code=True)`
- `faster-whisper-small` — `faster_whisper.WhisperModel`
- `faster-whisper-base` — optional smaller fallback using `faster_whisper.WhisperModel`

Audio is always converted to 16 kHz mono WAV via `ffmpeg` before model load.

## JSON contract

Success:

```json
{
  "provider": "local",
  "model": "<model-key>",
  "language": "hi",
  "segments": [
    {
      "segment_id": "seg_0001",
      "start_time": 0.0,
      "end_time": 5.2,
      "speaker": null,
      "text": "...",
      "confidence": 0.85,
      "language": "hi",
      "model": "<model-key>",
      "raw": {}
    }
  ],
  "raw": {"backend": "...", "device": "cpu", "elapsed_seconds": 42.3}
}
```

Failure:

```json
{
  "error": "MODEL_NOT_FOUND",
  "message": "...",
  "provider": "local",
  "model": "<model-key>",
  "details": {"...": "..."}
}
```

Node treats any non-zero exit as failure regardless of stdout. The next model
in the chain runs automatically when fallback is enabled.

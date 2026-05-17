#!/usr/bin/env python3
"""Download all configured STT model weights via huggingface_hub.

Reads repo + path triples from env vars set in .env:
    STT_PRIMARY_MODEL{,_REPO,_PATH}
    STT_FALLBACK_1_MODEL{,_REPO,_PATH}
    STT_FALLBACK_2_MODEL{,_REPO,_PATH}

Idempotent: snapshot_download deduplicates via the HF cache. Failures for one
model are reported and do not abort the others. Returns non-zero only if
*every* model failed.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional


@dataclass
class ModelSpec:
    name: str
    key: str          # human-readable model key
    repo: str         # HuggingFace repo id
    path: str         # destination directory


def specs_from_env() -> List[ModelSpec]:
    items: List[ModelSpec] = []

    def maybe_add(label: str, key_env: str, repo_env: str, path_env: str) -> None:
        enabled_env = key_env.removesuffix("_MODEL") + "_ENABLED"
        enabled = os.environ.get(enabled_env, "true").strip().lower()
        if enabled in {"false", "0", "no", "off"}:
            print(f"   [skip] {label}: {enabled_env}=false")
            return
        key = os.environ.get(key_env, "").strip()
        repo = os.environ.get(repo_env, "").strip()
        path = os.environ.get(path_env, "").strip()
        if not key or not repo or not path:
            print(f"   [skip] {label}: missing env (key={key!r}, repo={repo!r}, path={path!r})")
            return
        items.append(ModelSpec(name=label, key=key, repo=repo, path=path))

    maybe_add("primary", "STT_PRIMARY_MODEL", "STT_PRIMARY_MODEL_REPO", "STT_PRIMARY_MODEL_PATH")
    maybe_add("fallback_1", "STT_FALLBACK_1_MODEL", "STT_FALLBACK_1_MODEL_REPO", "STT_FALLBACK_1_MODEL_PATH")
    maybe_add("fallback_2", "STT_FALLBACK_2_MODEL", "STT_FALLBACK_2_MODEL_REPO", "STT_FALLBACK_2_MODEL_PATH")
    return items


def directory_size_human(p: Path) -> str:
    total = 0
    files = 0
    for root, _dirs, names in os.walk(p):
        for n in names:
            fp = Path(root) / n
            try:
                total += fp.stat().st_size
                files += 1
            except OSError:
                pass
    units = ["B", "KB", "MB", "GB"]
    size = float(total)
    unit_i = 0
    while size >= 1024 and unit_i < len(units) - 1:
        size /= 1024
        unit_i += 1
    return f"{files} files, {size:.1f} {units[unit_i]}"


def looks_downloaded(p: Path) -> bool:
    if not p.exists() or not p.is_dir():
        return False
    return (p / "config.json").is_file() or (p / "model.bin").is_file()


def download_one(spec: ModelSpec, hf_token: Optional[str]) -> bool:
    print()
    print(f"=== {spec.name} :: {spec.key} ===")
    print(f"    repo: {spec.repo}")
    print(f"    dest: {spec.path}")
    dest = Path(spec.path)
    dest.mkdir(parents=True, exist_ok=True)
    if looks_downloaded(dest):
        print(f"    SKIP already downloaded -> {directory_size_human(dest)}")
        return True

    try:
        from huggingface_hub import snapshot_download  # type: ignore
    except ImportError as exc:
        print(f"!! huggingface_hub not installed: {exc}")
        return False

    try:
        snapshot_download(
            repo_id=spec.repo,
            local_dir=spec.path,
            token=hf_token or None,
            # Skip large optimizer states / training-only artifacts where possible.
            ignore_patterns=[
                "*.msgpack",
                "*.h5",
                "*.ot",
                "*flax_model*",
                "*tf_model*",
                "*.bin.index.json",  # only if there's a safetensors equivalent
            ],
        )
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        print(f"!! download failed for {spec.repo}: {type(exc).__name__}: {msg}")
        lower = msg.lower()
        if "gated" in lower or "restricted" in lower or "401" in lower or "403" in lower:
            print("!! Open the model page in browser, accept access/contact sharing, then rerun with HF_TOKEN.")
        return False

    if not looks_downloaded(dest):
        print(f"!! download did not populate {dest}")
        return False

    size = directory_size_human(dest)
    print(f"    OK -> {size}")
    return True


def main() -> int:
    specs = specs_from_env()
    if not specs:
        print("!! No models configured in env.")
        return 2

    hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if hf_token:
        print("(using HF_TOKEN from env)")

    only = sys.argv[1:]
    if only:
        specs = [s for s in specs if s.key in only or s.name in only]
        if not specs:
            print(f"!! No matching model for filter {only}")
            return 2

    results: list[tuple[ModelSpec, bool]] = []
    for spec in specs:
        ok = download_one(spec, hf_token)
        results.append((spec, ok))

    print()
    print("=== Summary ===")
    for spec, ok in results:
        status = "OK  " if ok else "FAIL"
        print(f"  {status}  {spec.name:11s} {spec.key:30s} -> {spec.path}")

    any_ok = any(ok for _, ok in results)
    if not any_ok:
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

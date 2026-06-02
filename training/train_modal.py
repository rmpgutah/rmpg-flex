# ============================================================
# RMPG Flex — one-command cloud trainer (Modal)
# ============================================================
# Provisions a GPU on Modal, installs the stack, runs train_lora.py against
# your local dataset, and downloads the finished adapter back to ./training/
# adapter-v1 — no GPU box to set up by hand.
#
# One-time setup (local):
#   pip install modal
#   modal token new                       # auth to your Modal account
#   modal secret create huggingface HF_TOKEN=hf_xxx   # gated Llama access
#   # …and accept the Llama-3.3-70B license on huggingface.co for that token.
#
# Run:
#   modal run training/train_modal.py                       # 70B on H100
#   modal run training/train_modal.py --base meta-llama/Llama-3.1-8B-Instruct \
#       --cf-model @cf/meta/llama-3.1-8b-instruct-fast       # cheap 8B iterate
#   modal run training/train_modal.py --epochs 4 --rank 32   # override knobs
#
# Privacy note: your dist/*.jsonl (real PII) is uploaded to YOUR Modal compute
# for the run. That's your own cloud account — but it does leave this machine.
#
# RunPod / other GPU host alternative: skip this file and run train_lora.py
# directly on the box (see README Stage 3). This launcher is purely convenience.
# ============================================================

import pathlib

import modal

app = modal.App("rmpg-serve-intake-lora")

# The container stack = the same deps train_lora.py needs, + hf_transfer for a
# faster 70B download. Mirrors training/requirements.txt.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch>=2.4", "transformers>=4.46", "peft>=0.13", "trl>=0.12",
        "datasets>=3.0", "accelerate>=1.0", "bitsandbytes>=0.44",
        "safetensors>=0.4", "sentencepiece>=0.2", "hf_transfer>=0.1",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
    # Ship train_lora.py + dist/ into the container (excludes big/regenerable
    # artifacts). Added at runtime, so editing the script doesn't rebuild.
    .add_local_dir("training", "/root/work", ignore=["adapter-*", "__pycache__", "*.pyc"])
)

# Persist the ~140 GB base-model download across runs so only the FIRST run pays
# for it. Adapters are also stashed here as a belt-and-suspenders copy.
HF_CACHE_DIR = "/cache/huggingface"
cache = modal.Volume.from_name("rmpg-hf-cache", create_if_missing=True)


@app.function(
    image=image,
    gpu="H100",                                   # 70B QLoRA → 80 GB. For --base 8B, "A100-40GB" or "A10G" is plenty (and cheaper).
    timeout=4 * 60 * 60,                          # first run downloads 70B; training itself is minutes on this set.
    volumes={HF_CACHE_DIR: cache},
    secrets=[modal.Secret.from_name("huggingface")],  # exposes HF_TOKEN for the gated base
)
def train(base: str, cf_model: str, rank: int, alpha: int, epochs: float) -> dict:
    import os
    import subprocess

    os.environ["HF_HOME"] = HF_CACHE_DIR          # cache base weights on the Volume
    out = "/root/work/adapter-out"
    # Reuse the real trainer — no duplicated training logic.
    subprocess.run(
        ["python", "train_lora.py",
         "--train", "dist/train.jsonl", "--val", "dist/val.jsonl", "--out", out,
         "--base", base, "--cf-model", cf_model,
         "--rank", str(rank), "--alpha", str(alpha), "--epochs", str(epochs)],
        cwd="/root/work", check=True,
    )
    cache.commit()
    return {
        name: pathlib.Path(out, name).read_bytes()
        for name in ("adapter_model.safetensors", "adapter_config.json")
    }


@app.local_entrypoint()
def main(
    out: str = "training/adapter-v1",
    base: str = "meta-llama/Llama-3.3-70B-Instruct",
    cf_model: str = "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    rank: int = 16,
    alpha: int = 32,
    epochs: float = 3.0,
):
    print(f"Launching {base} QLoRA on Modal (gpu=H100) …")
    files = train.remote(base, cf_model, rank, alpha, epochs)
    dest = pathlib.Path(out)
    dest.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (dest / name).write_bytes(data)
        print(f"  wrote {dest / name}  ({len(data) / 1e6:.1f} MB)")
    print("\n✅ Adapter downloaded. Next:")
    print(f"  npx wrangler ai finetune create {cf_model} serve-intake-v1 {out}")
    print("  SERVE_INTAKE_LORA=serve-intake-v1 npx tsx training/run-eval.ts   # confirm positive delta")

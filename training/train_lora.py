#!/usr/bin/env python3
# ============================================================
# RMPG Flex — Serve-Intake LoRA trainer (offline GPU step)
# ============================================================
# Trains a LoRA adapter for the serve-intake field extractor so it can be
# uploaded to Workers AI (`wrangler ai finetune create`) and applied by
# extractFromText() at inference. This runs OFFLINE on a GPU — Workers AI
# hosts adapter inference, it does not train.
#
# Advanced techniques baked in (see README "Stage 3"):
#   • Completion-only loss — we mask the prompt and compute loss ONLY on the
#     assistant JSON. The model learns to EXTRACT, not to echo the 4 KB system
#     prompt. Highest-leverage setting for this task.
#   • Anti-overfit regularization — with ~40 rows a LoRA memorizes fast, so we
#     default to modest rank, real dropout, few epochs, cosine decay, and
#     load_best_model_at_end on eval loss (early-stop the memorization).
#   • QLoRA (4-bit base) — fits the 70B base on a single 80 GB GPU.
#   • Chat template parity — we apply the tokenizer's llama-3 chat template, the
#     same one Workers AI uses with raw:true at inference (train/serve match).
#
# Cloudflare adapter constraints enforced on export: rank ≤ 32, model_type
# "llama", task_type CAUSAL_LM, files named exactly adapter_model.safetensors /
# adapter_config.json, < 300 MB.
#
# Usage:
#   pip install -r training/requirements.txt
#   python training/train_lora.py \
#       --train training/dist/train.jsonl --val training/dist/val.jsonl \
#       --out training/adapter-v1
#
# GPU sizing: Llama-3.3-70B QLoRA needs ~1×A100/H100 80 GB. To iterate cheaply,
# pass --base meta-llama/Llama-3.1-8B-Instruct (served on CF as
# @cf/meta/llama-3.1-8b-instruct-fast) — fits a 24 GB card. Train the adapter
# against the SAME base you will serve.
# ============================================================

import argparse
import json
import os
import sys


def parse_args():
    p = argparse.ArgumentParser(description="Train a serve-intake LoRA adapter.")
    p.add_argument("--train", default="training/dist/train.jsonl")
    p.add_argument("--val", default="training/dist/val.jsonl")
    p.add_argument("--out", default="training/adapter-v1")
    p.add_argument("--base", default="meta-llama/Llama-3.3-70B-Instruct",
                   help="HF base; train against the SAME arch you serve on Workers AI.")
    p.add_argument("--cf-model", default="@cf/meta/llama-3.3-70b-instruct-fp8-fast",
                   help="The Workers AI model you'll attach the adapter to (must match --base arch).")
    # LoRA — rank/alpha kept conservative for a small dataset. r MUST be ≤ 32
    # for Workers AI. alpha = 2×r is a common, stable default.
    p.add_argument("--rank", type=int, default=16)
    p.add_argument("--alpha", type=int, default=32)
    p.add_argument("--dropout", type=float, default=0.1,
                   help="Higher than usual (0.05→0.1) — small data overfits.")
    # Optimization — few epochs + cosine + warmup; early-stop on eval loss.
    p.add_argument("--epochs", type=float, default=3.0)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--batch", type=int, default=1)
    p.add_argument("--grad-accum", type=int, default=8)
    p.add_argument("--max-seq-len", type=int, default=8192,
                   help="Packets are long; 8K covers most. Raise if rawText truncates.")
    p.add_argument("--no-4bit", action="store_true", help="Disable QLoRA 4-bit (needs more VRAM).")
    return p.parse_args()


def main():
    args = parse_args()
    # Imported here so --help works without the heavy stack installed.
    import torch
    from datasets import load_dataset
    from transformers import (AutoModelForCausalLM, AutoTokenizer,
                              BitsAndBytesConfig, EarlyStoppingCallback)
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from trl import SFTConfig, SFTTrainer, DataCollatorForCompletionOnlyLM

    for f in (args.train, args.val):
        if not os.path.exists(f):
            sys.exit(f"Missing {f} — run `npx tsx training/build-dataset.ts` first.")

    print(f"Base: {args.base}  |  LoRA r={args.rank} α={args.alpha} dropout={args.dropout}")
    tok = AutoTokenizer.from_pretrained(args.base)
    tok.padding_side = "right"
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    quant = None
    if not args.no_4bit:
        quant = BitsAndBytesConfig(
            load_in_4bit=True, bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True,
        )
    model = AutoModelForCausalLM.from_pretrained(
        args.base, quantization_config=quant, torch_dtype=torch.bfloat16,
        device_map="auto", attn_implementation="eager",
    )
    model.config.use_cache = False
    if quant is not None:
        model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)

    # All attention + MLP projections — the standard, effective target set for
    # llama. Touching the MLP (gate/up/down) matters for a structured-output
    # task like JSON extraction, not just the attention q/v.
    lora = LoraConfig(
        r=args.rank, lora_alpha=args.alpha, lora_dropout=args.dropout, bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    # Render {messages:[…]} → a single templated string. tokenize=False keeps it
    # text; the collator below tokenizes + masks. This template is the one
    # Workers AI replays with raw:true, so training and serving align.
    def render(ex):
        return {"text": tok.apply_chat_template(ex["messages"], tokenize=False)}

    ds = load_dataset("json", data_files={"train": args.train, "val": args.val})
    ds = ds.map(render, remove_columns=ds["train"].column_names)

    # Completion-only: loss is computed ONLY after the assistant header, so the
    # model is never trained to reproduce the (huge) system+user prompt. The
    # response template is the llama-3 assistant turn opener.
    response_template = "<|start_header_id|>assistant<|end_header_id|>\n\n"
    collator = DataCollatorForCompletionOnlyLM(response_template, tokenizer=tok)

    cfg = SFTConfig(
        output_dir=args.out,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        per_device_eval_batch_size=args.batch,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        weight_decay=0.01,
        max_seq_length=args.max_seq_len,
        packing=False,                       # MUST be False for completion-only masking
        bf16=True,
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        logging_steps=5,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=2,
        load_best_model_at_end=True,         # keep the checkpoint with lowest eval loss
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        report_to="none",
    )
    trainer = SFTTrainer(
        model=model, args=cfg,
        train_dataset=ds["train"], eval_dataset=ds["val"],
        data_collator=collator,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=2)],
    )
    trainer.train()

    # Save adapter, then make it Workers-AI compatible: PEFT omits model_type,
    # which Cloudflare requires. Patch it and sanity-check the constraints.
    trainer.model.save_pretrained(args.out)
    cfg_path = os.path.join(args.out, "adapter_config.json")
    with open(cfg_path) as fh:
        ac = json.load(fh)
    ac["model_type"] = "llama"
    ac.setdefault("task_type", "CAUSAL_LM")
    with open(cfg_path, "w") as fh:
        json.dump(ac, fh, indent=2)

    if ac.get("r", args.rank) > 32:
        print("⚠ rank > 32 — Workers AI will reject this adapter.")
    weights = os.path.join(args.out, "adapter_model.safetensors")
    if os.path.exists(weights):
        mb = os.path.getsize(weights) / 1e6
        print(f"adapter_model.safetensors: {mb:.1f} MB {'⚠ >300 MB!' if mb > 300 else 'OK (<300 MB)'}")

    print(f"\n✅ Adapter → {args.out}")
    print("Next:")
    print(f"  npx wrangler ai finetune create {args.cf_model} serve-intake-v1 {args.out}")
    print("  # then: SERVE_INTAKE_LORA=serve-intake-v1 npx tsx training/run-eval.ts   (confirm positive delta)")


if __name__ == "__main__":
    main()

# Serve-Intake Field-Extraction LoRA

Fine-tuning the **text-extraction step** of the serve-intake OCR pipeline —
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, the model in
[`src/utils/serveIntakeExtract.ts`](../src/utils/serveIntakeExtract.ts) that
turns OCR text into structured fields (`extractFromText`).

> ⚠️ **PII.** Files under `training/data/` are real service-of-process packets
> (live names, DOBs, addresses, case numbers). They are `.gitignore`d. Keep them
> off git, off Slack, and out of any external service. Train on a machine you control.

## The four stages

| Stage | Where | Command |
|---|---|---|
| 1. Build dataset | this repo | `npx tsx training/build-dataset.ts` |
| 2. Baseline eval | this repo | `… npx tsx training/run-eval.ts` |
| 3. Train adapter | offline GPU | AutoTrain / TRL (below) |
| 4. Upload + enable | `wrangler` + this repo | `wrangler ai finetune create …` then set `SERVE_INTAKE_LORA` |

Why only inference wiring lives here: **Workers AI hosts LoRA *inference*, it does
not *train* the adapter.** Training happens on a GPU box and emits two files.

## Stage 1 — Label & build

For each failing doc, write `training/data/<id>.json`:

```json
{
  "id": "job-13572468",
  "rawText": "…the exact OCR text the pipeline saw…",
  "expected": {
    "documentType": "summons",
    "fields": {
      "recipient_first_name": "John",
      "recipient_last_name": "Sample",
      "recipient_dob": "1985-03-04",
      "case_number": ""
    }
  }
}
```

- `rawText` must be the **same text prod fed the model** (the container/pdfjs
  output), not the raw PDF. Easiest source: the `rawText` field the current
  extractor already returns — copy it, then **correct the `fields`** to ground truth.
- Omit fields you don't care about (they default to `""` = "correctly absent").
- An empty string is a real label: it teaches the model *not* to hallucinate.

There's also a **bootstrap labeler** that drafts labels straight from ServeManager
packets (Information Form CSV + Field Sheet + Court Docket), so you verify instead
of type from scratch:

```bash
npx tsx training/label-servemanager.ts "/path/to/ICU Investigations"
# → training/data/<job>.json drafts, each "_verified": false with a "_review" list
```

Eyeball each draft, fix any flagged fields, set `"_verified": true`. Then build:

```bash
npx tsx training/build-dataset.ts
# → training/dist/train.jsonl, val.jsonl  ({"messages":[system,user,assistant]} per line)
# Only "_verified": true docs are included — a bad auto-label can't poison the weights.
# Add --include-unverified to build from ALL drafts (fast experiments only).
```

Augmentation is **on by default**: each CSV-backed doc also emits a copy with the
embedded `Imported CSV Row` JSON removed (same target), forcing the model to read
the rendered layout instead of transcribing the CSV. `--no-augment` to disable.
Both views of a doc share its id, so they stay in the same train/val split.

The (system, user) half comes from `buildExtractionMessages()` — the **same**
function prod inference uses — so there is zero train/serve prompt skew.

**Rule of thumb on volume:** a field-extraction LoRA starts paying off around
50–100 labeled docs and gets solid at a few hundred. Bias toward the document
types and failure modes you actually see go wrong.

## Stage 2 — Baseline, then re-eval after training

```bash
CLOUDFLARE_ACCOUNT_ID=xxx CLOUDFLARE_API_TOKEN=xxx npx tsx training/run-eval.ts
```

Prints the stock-70B weighted score + weakest fields on the held-out val split.
**Record this number** — it's the bar the LoRA must beat. The scoring rubric is
[`training/eval.ts → scoreField`](eval.ts) (field weights + match logic live there).

## Stage 3 — Train the adapter (offline GPU)

Use the included trainer ([`train_lora.py`](train_lora.py)) — a PEFT + TRL QLoRA
script with the advanced settings this task needs. (Cloudflare's
[AutoTrain tutorial](https://developers.cloudflare.com/workers-ai/guides/tutorials/fine-tune-models-with-autotrain/)
is the no-code alternative, but the script gives you completion-only loss and
the regularization knobs, which matter on a small set.)

```bash
pip install -r training/requirements.txt
python training/train_lora.py \
  --train training/dist/train.jsonl --val training/dist/val.jsonl \
  --out training/adapter-v1
# → training/adapter-v1/{adapter_model.safetensors, adapter_config.json}
# model_type:"llama" is patched in and rank/size are checked automatically.
```

**GPU sizing.** Llama-3.3-70B QLoRA needs ~1×A100/H100 **80 GB**. To iterate
cheaply on a 24 GB card, train against the 8B base and serve it on the matching
CF model:

```bash
python training/train_lora.py --base meta-llama/Llama-3.1-8B-Instruct \
  --cf-model @cf/meta/llama-3.1-8b-instruct-fast --out training/adapter-8b-v1
```

### Why these settings (the "advanced" part)

| Setting | Default | Why |
|---|---|---|
| **Completion-only loss** | on | Loss is computed *only* on the assistant JSON, not the 4 KB prompt. The adapter learns to **extract**, not to echo instructions. Biggest single lever. |
| **LoRA rank `r`** | 16 | Low rank = fewer params to overfit ~40 rows. Must be ≤ 32 for Workers AI. Bump to 32 only if val loss is still falling at stop. |
| **`alpha`** | 32 | 2×r — standard, stable scaling. |
| **dropout** | 0.10 | Higher than the usual 0.05 *because* the set is small; regularizes hard. |
| **epochs** | 3 | More than ~3 on 40 rows memorizes. `EarlyStopping(patience=2)` + `load_best_model_at_end` cut it off when val loss turns up. |
| **lr** | 2e-4 | Typical QLoRA LR; cosine decay + 5% warmup. |
| **target_modules** | all q/k/v/o + gate/up/down | Touching the MLP (not just attention) helps structured-JSON tasks. |

### Reading the run

Watch **eval loss**, not train loss. Train loss will drop fast (small data);
the moment **eval loss stops improving is your real stopping point** — the script
keeps that checkpoint automatically. If eval loss never improves over the base,
the data is too small or too noisy — gather/verify more docs before trusting a run.

Constraints the script enforces on export: rank ≤ 32, `adapter_model.safetensors`
< 300 MB, exact filenames, `model_type:"llama"` + `task_type:"CAUSAL_LM"`.

> **Honest scope note.** 51 verified docs (→ 68 rows with augmentation) is the
> *low end* for a fine-tune. Expect a modest, real gain on the fields you labeled
> well — not magic. The highest-ROI next step is almost always **more verified
> data** (finish the held docs, label new packets), not hyperparameter fiddling.

## Stage 4 — Upload, eval, enable

```bash
# Upload (creates the finetune + pushes both files)
npx wrangler ai finetune create @cf/meta/llama-3.3-70b-instruct-fp8-fast \
  serve-intake-v1 /path/to/adapter-folder
npx wrangler ai finetune list   # confirm

# Compare against baseline BEFORE touching prod
CLOUDFLARE_ACCOUNT_ID=xxx CLOUDFLARE_API_TOKEN=xxx \
  SERVE_INTAKE_LORA=serve-intake-v1 npx tsx training/run-eval.ts
```

Only if the LoRA delta is positive, enable it in prod:

```bash
npx wrangler secret put SERVE_INTAKE_LORA   # value: serve-intake-v1
```

`extractFromText` picks it up automatically (passes `lora` + `raw: true`).
Unset the var to instantly revert to the stock model — no redeploy needed.

## Iterating

Adapter assets can't be edited in place — bump the name (`serve-intake-v2`),
upload fresh, re-eval, then repoint the secret. Keep each version's val score in
this README so the trend is visible.
```
| version | val weighted score | notes |
|---------|-------------------|-------|
| base    | (record me)       | stock 70B |
| v1      |                   |       |
```

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

## Stage 3 — Train the adapter (offline)

Follow Cloudflare's tutorial:
<https://developers.cloudflare.com/workers-ai/guides/tutorials/fine-tune-models-with-autotrain/>

Constraints Workers AI enforces on the uploaded adapter:

- Base model **must** be a LoRA-capable one — use `llama-3.3-70b` (matches prod).
- LoRA rank `r ≤ 32`.
- `adapter_model.safetensors` **< 300 MB**.
- Files named **exactly** `adapter_model.safetensors` and `adapter_config.json`.
- `adapter_config.json` must include `"model_type": "llama"` and `"task_type": "CAUSAL_LM"`.

Train on `train.jsonl`; hold out `val.jsonl`. The trainer applies the llama-3
chat template to the `messages` rows — keep that consistent with the `raw: true`
inference path (see the note in `extractFromText`).

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

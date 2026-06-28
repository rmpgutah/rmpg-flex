# flex-edge — RMPG Flex Dashcam AI edge runner

Python package that runs in-vehicle on Jetson Orin Nano, captures
from front + driver-facing cameras, runs ML inference for
forward-collision / lane-departure / driver-monitoring / harsh-event
detection, and posts events + clips to RMPG Flex's
`/api/dashcam-ai/*` webhooks.

This package is **structured-first, capability-second**. The current
state is a scaffold: HMAC signer, HTTP client, CLI, and event
simulator — enough to smoke-test the server endpoints end-to-end
before any real hardware ships. Inference, capture, and ring-buffer
modules are stubs that will be filled in as Phase 1 progresses.

## Architecture

```
┌──────────────────────────────────────────────┐
│ Jetson Orin Nano (per cruiser)               │
│                                              │
│   gstreamer ──▶ NVENC (h264, ring buffer)    │
│              └▶ NVDEC ──▶ TensorRT engines:  │
│                            ├ openpilot FCW   │
│                            ├ MediaPipe DMS   │
│                            ├ RT-DETR objects │
│                            └ MiDaS depth     │
│                                              │
│   event-builder ── threshold + dedup ──▶     │
│   uploader (this package) ── HMAC POST ──▶   │
└──────────────────────────────────────────────┘
                       │
                       ▼
              RMPG Flex /api/dashcam-ai/event
                       │
                       ▼
              driving_events + evidence_hashes
```

## Layout

```
flex_edge/
  signer.py       HMAC-SHA256 signed-body signer
                  (mirror of server/src/utils/dashcamAiHmac.ts)
  client.py       HTTP client for POST /event and /heartbeat
  cli.py          Command-line interface (send-event, heartbeat,
                  simulate)
  simulator.py    Synthetic-event generator for testing without a
                  Jetson — useful for client UI dev too
  capture/        gstreamer pipelines (placeholder)
  inference/      TensorRT engines (placeholder)
  events/         Threshold + persistence + dedup (placeholder)
  ringbuffer/     Append-only h264 chunks (placeholder)
tests/
  test_signer.py
  test_client.py
```

## Quickstart (dev — without a Jetson)

```bash
cd edge
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'

# Run tests
pytest

# Set the shared secret (must match server's DASHCAM_FORWARD_SECRET)
export FLEX_DASHCAM_SECRET='your-shared-secret'
export FLEX_BASE_URL='http://localhost:3001'

# Smoke-test against a running Flex server
flex-edge heartbeat --unit-id 12 --device-id jetson-12 --gpu-temp 56.4
flex-edge send-event --unit-id 12 --device-id jetson-12 --type fcw --severity warning
flex-edge send-event --unit-id 12 --device-id jetson-12 --type impact --severity critical --clip ./test-clip.mp4

# Generate fake events for client UI development
flex-edge simulate --unit-ids 12,7,3 --rate 1
```

## Server-side configuration prerequisites

Before any of the above commands work, the server must have:

```bash
# /opt/rmpg-flex/server/.env (or env vars in systemd unit)
DASHCAM_FORWARD_SECRET=<long-random-secret>           # required
DASHCAM_AI_STORAGE_DIR=/opt/rmpg-flex/server/data/dashcam-ai-evidence  # optional
```

Per CLAUDE.md gotcha #1, `DASHCAM_FORWARD_SECRET` is intentionally
**separate** from `JWT_SECRET` so it can be rotated independently
without breaking TOTP encryption.

## On-device install (Jetson)

Documented separately as the procedure ships. Outline:

1. Flash Jetson Orin Nano with JetPack 6.1
2. Install system deps: `apt install gstreamer1.0-tools gstreamer1.0-plugins-bad`
3. Install flex-edge with Jetson extras: `pip install '.[jetson]'`
4. Copy systemd unit + signed config to `/etc/`
5. Provision shared secret via tamper-evident enclosure setup
6. First-boot heartbeat reaches Flex → unit appears in
   `dashcam_health` table → fleet UI lights green

## Versioning + OTA

Edge binary version reported in heartbeat → server logs in
`dashcam_health.firmware_version`. OTA push: see Phase 4 design
(not implemented yet).

## Why Python first

Every model we'll integrate (openpilot, MediaPipe, RT-DETR,
PaddleOCR, MiDaS) ships a Python API first; Rust bindings lag.
We may rewrite hot paths (encoder pipeline, ring buffer) in Rust
later if Python overhead matters on real hardware. YAGNI until
profiling says otherwise.

## License

MIT — same as RMPG Flex. Inference dependencies have varying
licenses; see `THIRD_PARTY_LICENSES.md` once integrated. Notable
**avoid**: Ultralytics YOLO (AGPL since 2023). Use YOLO-NAS,
RT-DETR, or MMDetection instead.

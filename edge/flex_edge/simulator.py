"""Synthetic event generator for testing without a Jetson.

Useful for:
  - End-to-end smoke tests of /api/dashcam-ai/* without hardware
  - Client-side UI development (event listings, fleet health LEDs,
    map overlays) before any real cruiser is instrumented
  - Soak-testing the storage adapter and chain-of-custody under
    sustained load

Generates a plausible mix of event types weighted toward
realism — most events are heartbeats and ignition transitions;
critical events (impact, sos) are rare. Locations cluster around
RMPG's operational area (Salt Lake City) by default.

This is a TESTING tool. It does NOT replace the Jetson runner —
no inference, no real GPS, no real video.
"""
from __future__ import annotations

import io
import os
import random
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, Optional

from flex_edge.client import FlexDashcamClient


# Salt Lake City operational area (rough bounding box). Sampled
# uniformly — close enough for UI dev, wrong for any analytic use.
_LAT_MIN, _LAT_MAX = 40.65, 40.85
_LNG_MIN, _LNG_MAX = -111.95, -111.80


# Event-type frequency weights — reflects rough realism so a
# 1-hour soak doesn't fill the DB with critical events. Tune as
# you see how dispatch UIs handle the volume.
_EVENT_WEIGHTS: list[tuple[str, str, float]] = [
    # (event_type, severity, weight)
    ("hard_brake", "warning", 20),
    ("hard_accel", "warning", 8),
    ("hard_turn", "warning", 5),
    ("speeding", "warning", 15),
    ("fcw", "warning", 6),
    ("ldw", "info", 10),
    ("tailgate", "warning", 4),
    ("drowsy", "alert", 1),
    ("distracted", "alert", 2),
    ("ignition_on", "info", 1),
    ("ignition_off", "info", 1),
    ("impact", "critical", 0.05),
    ("sos", "critical", 0.02),
]


@dataclass
class SimulatorConfig:
    unit_ids: list[int]
    rate_per_sec: float = 1.0
    duration_sec: Optional[float] = None
    include_clips: bool = False
    clip_size_kb: int = 64
    seed: Optional[int] = None


def _local_now() -> str:
    """Match server's localNow() format: 'YYYY-MM-DD HH:MM:SS'."""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _pick_event(rng: random.Random) -> tuple[str, str]:
    types = [(t, s) for t, s, _ in _EVENT_WEIGHTS]
    weights = [w for _, _, w in _EVENT_WEIGHTS]
    return rng.choices(types, weights=weights, k=1)[0]


def _fake_clip(size_kb: int, rng: random.Random) -> bytes:
    """Random bytes prefixed with a fake mp4 ftyp box — the server
    treats clips as opaque blobs so the contents don't matter, but
    a recognizable header makes manual debugging less confusing."""
    buf = io.BytesIO()
    buf.write(b"\x00\x00\x00\x20ftypmp42\x00\x00\x00\x01mp42mp41iso5")
    buf.write(rng.randbytes(size_kb * 1024 - buf.tell()))
    return buf.getvalue()


def run_simulation(client: FlexDashcamClient, config: SimulatorConfig) -> Iterable[dict]:
    """Yield one event-dispatch result per generated event.

    Sleeps between events to honor ``rate_per_sec``. Stops after
    ``duration_sec`` if set, otherwise runs until the caller
    stops iterating.

    Each yielded dict has keys: unit_id, event_type, severity,
    server_response, sent_at.
    """
    rng = random.Random(config.seed) if config.seed is not None else random.Random()
    start = time.monotonic()
    interval = 1.0 / max(config.rate_per_sec, 0.001)

    while True:
        if config.duration_sec is not None and time.monotonic() - start > config.duration_sec:
            return

        unit_id = rng.choice(config.unit_ids)
        event_type, severity = _pick_event(rng)
        ts = _local_now()
        latitude = rng.uniform(_LAT_MIN, _LAT_MAX)
        longitude = rng.uniform(_LNG_MIN, _LNG_MAX)

        kwargs: dict = dict(
            event_type=event_type,
            event_timestamp=ts,
            unit_id=unit_id,
            device_id=f"sim-{unit_id}",
            severity=severity,
            source_event_id=f"sim-{unit_id}-{ts}-{event_type}-{rng.randrange(1<<24):x}",
            latitude=round(latitude, 6),
            longitude=round(longitude, 6),
            heading=rng.uniform(0, 360),
            speed_mph=round(rng.uniform(0, 75), 1),
            duration_sec=60,
            model_version="sim-0.1.0",
            confidence=round(rng.uniform(0.7, 0.99), 2),
        )
        if config.include_clips:
            kwargs["clip"] = _fake_clip(config.clip_size_kb, rng)
            kwargs["clip_filename"] = f"sim-{unit_id}-{event_type}.mp4"

        try:
            resp = client.send_event(**kwargs)
            yield {"unit_id": unit_id, "event_type": event_type, "severity": severity, "server_response": resp, "sent_at": ts}
        except Exception as exc:  # noqa: BLE001
            yield {"unit_id": unit_id, "event_type": event_type, "severity": severity, "error": str(exc), "sent_at": ts}

        time.sleep(interval)

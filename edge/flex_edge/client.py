"""HTTP client for Flex Dashcam AI webhooks.

POSTs HMAC-signed JSON payloads to /api/dashcam-ai/event and
/api/dashcam-ai/heartbeat. Uses a single requests.Session for
connection pooling — Jetson runners hit /heartbeat every 30s,
so amortizing the TLS handshake matters.

Raises FlexDashcamHttpError on any non-2xx response. Callers
that want retry logic should wrap the call themselves; we
intentionally don't retry inside the client because:
  - 401 means misconfigured secret → operator must intervene
  - 400 means malformed payload → bug, not transient
  - 503 means service_not_configured → operator intervention
  - 5xx and timeouts: caller decides backoff strategy based on
    whether the event is replaceable (heartbeat) or essential
    (event with clip — needs more aggressive retry from the
    edge ring buffer, which the calling code owns)
"""
from __future__ import annotations

import base64
import json
import time
from typing import Any, Optional, Union

import requests

from flex_edge.signer import sign_payload


class FlexDashcamHttpError(Exception):
    """Raised when the server returns a non-2xx response."""

    def __init__(self, status_code: int, body: str):
        super().__init__(f"Flex returned HTTP {status_code}: {body[:300]}")
        self.status_code = status_code
        self.body = body


class FlexDashcamClient:
    """HMAC-signed HTTP client for Flex Dashcam AI webhooks.

    Parameters
    ----------
    base_url:
        Flex server base URL, e.g. ``"https://rmpgutah.us"`` or
        ``"http://localhost:3001"`` for dev. Trailing slash optional.
    secret:
        Shared secret matching server's ``DASHCAM_FORWARD_SECRET``.
    timeout:
        Per-request timeout in seconds. Defaults to 15s.
    """

    def __init__(self, base_url: str, secret: str, timeout: float = 15.0):
        self._base_url = base_url.rstrip("/")
        self._secret = secret
        self._timeout = timeout
        self._session = requests.Session()
        self._session.headers.update({
            "User-Agent": "flex-edge/0.1.0",
        })

    # ── Public API ────────────────────────────────────────────────

    def send_event(
        self,
        *,
        event_type: str,
        event_timestamp: str,
        unit_id: int,
        device_id: str,
        severity: Optional[str] = None,
        source_event_id: Optional[str] = None,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        heading: Optional[float] = None,
        speed_mph: Optional[float] = None,
        address: Optional[str] = None,
        duration_sec: Optional[int] = None,
        model_version: Optional[str] = None,
        confidence: Optional[float] = None,
        raw_metadata: Optional[dict] = None,
        clip: Optional[bytes] = None,
        clip_filename: Optional[str] = None,
    ) -> dict:
        """POST a driving event to /api/dashcam-ai/event.

        ``clip`` is the raw video bytes; the client base64-encodes
        for transport (~33% size inflation, acceptable for v0).
        Returns the parsed JSON response on 2xx, raises
        FlexDashcamHttpError otherwise.
        """
        payload: dict[str, Any] = {
            "event_type": event_type,
            "event_timestamp": event_timestamp,
            "unit_id": unit_id,
            "device_id": device_id,
        }
        # Optional fields — only include non-None to keep JSON small
        for key, value in (
            ("severity", severity),
            ("source_event_id", source_event_id),
            ("latitude", latitude),
            ("longitude", longitude),
            ("heading", heading),
            ("speed_mph", speed_mph),
            ("address", address),
            ("duration_sec", duration_sec),
            ("model_version", model_version),
            ("confidence", confidence),
            ("raw_metadata", raw_metadata),
        ):
            if value is not None:
                payload[key] = value

        if clip is not None:
            payload["clip_base64"] = base64.b64encode(clip).decode("ascii")
            payload["clip_filename"] = clip_filename or "clip.mp4"

        return self._post_signed("/api/dashcam-ai/event", payload)

    def send_heartbeat(
        self,
        *,
        unit_id: int,
        device_id: str,
        device_kind: str = "flex_ai",
        firmware_version: Optional[str] = None,
        model_version: Optional[str] = None,
        gpu_temp_c: Optional[float] = None,
        cpu_temp_c: Optional[float] = None,
        disk_used_pct: Optional[float] = None,
        ram_used_pct: Optional[float] = None,
        network_status: Optional[str] = None,
        lte_rssi_dbm: Optional[int] = None,
        last_error: Optional[str] = None,
        uptime_sec: Optional[int] = None,
    ) -> dict:
        """POST a fleet-health heartbeat to /api/dashcam-ai/heartbeat."""
        payload: dict[str, Any] = {
            "unit_id": unit_id,
            "device_id": device_id,
            "device_kind": device_kind,
        }
        for key, value in (
            ("firmware_version", firmware_version),
            ("model_version", model_version),
            ("gpu_temp_c", gpu_temp_c),
            ("cpu_temp_c", cpu_temp_c),
            ("disk_used_pct", disk_used_pct),
            ("ram_used_pct", ram_used_pct),
            ("network_status", network_status),
            ("lte_rssi_dbm", lte_rssi_dbm),
            ("last_error", last_error),
            ("uptime_sec", uptime_sec),
        ):
            if value is not None:
                payload[key] = value

        return self._post_signed("/api/dashcam-ai/heartbeat", payload)

    # ── Internals ─────────────────────────────────────────────────

    def _post_signed(self, path: str, payload: dict) -> dict:
        # Serialize ONCE — the bytes we sign MUST be the bytes we send.
        # Any reformat between sign and send (whitespace, key order)
        # would break the server's HMAC verification.
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        timestamp = int(time.time())
        signature = sign_payload(self._secret, timestamp, body)

        headers = {
            "Content-Type": "application/json",
            "X-Dashcam-Timestamp": str(timestamp),
            "X-Dashcam-Signature": signature,
        }

        resp = self._session.post(
            url=f"{self._base_url}{path}",
            data=body,
            headers=headers,
            timeout=self._timeout,
        )

        if resp.status_code < 200 or resp.status_code >= 300:
            raise FlexDashcamHttpError(resp.status_code, resp.text)

        try:
            return resp.json()
        except (ValueError, json.JSONDecodeError):
            return {"raw": resp.text}

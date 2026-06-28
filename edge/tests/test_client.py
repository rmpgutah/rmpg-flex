"""HTTP client tests — verify request shape AND HMAC validity.

Capture-and-verify pattern: we mock requests.Session.post to capture
(url, headers, body), then re-run sign_payload over the captured body
and assert the captured signature matches. This is much stronger than
"was post() called?" — it proves the request would be accepted by the
server without needing a live server in the test.
"""
import base64
import json
from unittest.mock import patch, MagicMock

import pytest

from flex_edge.client import FlexDashcamClient
from flex_edge.signer import sign_payload, REPLAY_WINDOW_SEC


SECRET = "test-shared-secret-must-be-32-chars-minimum"
BASE_URL = "http://localhost:3001"


def _ok_response(json_body: dict) -> MagicMock:
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = json_body
    resp.text = json.dumps(json_body)
    return resp


def _capture_request(post_mock):
    """Pull (url, headers, body) out of a mocked Session.post call."""
    assert post_mock.call_count == 1, f"expected 1 POST, got {post_mock.call_count}"
    call = post_mock.call_args
    url = call.kwargs.get("url") or call.args[0]
    headers = call.kwargs["headers"]
    body = call.kwargs["data"]
    if isinstance(body, str):
        body = body.encode("utf-8")
    return url, headers, body


# ── send_event ──────────────────────────────────────────────────────


def test_send_event_posts_to_correct_url():
    client = FlexDashcamClient(BASE_URL, SECRET)
    with patch.object(client._session, "post", return_value=_ok_response({"ok": True, "event_id": 1, "evidence_id": None, "deduped": False})) as mock_post:
        client.send_event(
            event_type="fcw",
            event_timestamp="2026-04-28 12:00:00",
            unit_id=12,
            device_id="jetson-12",
        )
    url, _, _ = _capture_request(mock_post)
    assert url == f"{BASE_URL}/api/dashcam-ai/event"


def test_send_event_includes_signature_and_timestamp_headers():
    client = FlexDashcamClient(BASE_URL, SECRET)
    with patch.object(client._session, "post", return_value=_ok_response({"ok": True, "event_id": 1, "evidence_id": None, "deduped": False})) as mock_post:
        client.send_event(
            event_type="fcw",
            event_timestamp="2026-04-28 12:00:00",
            unit_id=12,
            device_id="jetson-12",
        )
    _, headers, _ = _capture_request(mock_post)
    assert "X-Dashcam-Signature" in headers
    assert headers["X-Dashcam-Signature"].startswith("sha256=")
    assert "X-Dashcam-Timestamp" in headers
    assert int(headers["X-Dashcam-Timestamp"]) > 0


def test_send_event_signature_actually_validates_against_body():
    """Re-sign the captured body and confirm the captured signature
    matches. This is the cross-check that proves the server would
    accept the request."""
    client = FlexDashcamClient(BASE_URL, SECRET)
    with patch.object(client._session, "post", return_value=_ok_response({"ok": True, "event_id": 1, "evidence_id": None, "deduped": False})) as mock_post:
        client.send_event(
            event_type="hard_brake",
            event_timestamp="2026-04-28 12:00:00",
            unit_id=12,
            device_id="jetson-12",
            severity="warning",
            latitude=40.76,
            longitude=-111.89,
        )
    _, headers, body = _capture_request(mock_post)
    ts = int(headers["X-Dashcam-Timestamp"])
    expected = sign_payload(SECRET, ts, body)
    assert headers["X-Dashcam-Signature"] == expected


def test_send_event_serializes_payload_as_json_with_required_fields():
    client = FlexDashcamClient(BASE_URL, SECRET)
    with patch.object(client._session, "post", return_value=_ok_response({"ok": True, "event_id": 1, "evidence_id": None, "deduped": False})) as mock_post:
        client.send_event(
            event_type="fcw",
            event_timestamp="2026-04-28 12:00:00",
            unit_id=12,
            device_id="jetson-12",
            severity="warning",
            confidence=0.87,
        )
    _, _, body = _capture_request(mock_post)
    payload = json.loads(body)
    assert payload["event_type"] == "fcw"
    assert payload["event_timestamp"] == "2026-04-28 12:00:00"
    assert payload["unit_id"] == 12
    assert payload["device_id"] == "jetson-12"
    assert payload["severity"] == "warning"
    assert payload["confidence"] == 0.87


def test_send_event_with_clip_base64_encodes_bytes():
    client = FlexDashcamClient(BASE_URL, SECRET)
    clip_bytes = b"fake mp4 bytes \x00\x01\x02"
    with patch.object(client._session, "post", return_value=_ok_response({"ok": True, "event_id": 1, "evidence_id": 5, "deduped": False})) as mock_post:
        client.send_event(
            event_type="impact",
            event_timestamp="2026-04-28 12:00:00",
            unit_id=12,
            device_id="jetson-12",
            severity="critical",
            clip=clip_bytes,
            clip_filename="front.mp4",
        )
    _, _, body = _capture_request(mock_post)
    payload = json.loads(body)
    assert payload["clip_filename"] == "front.mp4"
    decoded = base64.b64decode(payload["clip_base64"])
    assert decoded == clip_bytes


def test_send_event_returns_parsed_response():
    client = FlexDashcamClient(BASE_URL, SECRET)
    expected = {"ok": True, "event_id": 42, "evidence_id": 7, "deduped": False}
    with patch.object(client._session, "post", return_value=_ok_response(expected)):
        result = client.send_event(
            event_type="fcw",
            event_timestamp="2026-04-28 12:00:00",
            unit_id=12,
            device_id="jetson-12",
        )
    assert result == expected


def test_send_event_raises_on_401():
    client = FlexDashcamClient(BASE_URL, SECRET)
    resp = MagicMock()
    resp.status_code = 401
    resp.text = '{"error":"unauthorized"}'
    with patch.object(client._session, "post", return_value=resp):
        with pytest.raises(Exception) as excinfo:
            client.send_event(
                event_type="fcw",
                event_timestamp="2026-04-28 12:00:00",
                unit_id=12,
                device_id="jetson-12",
            )
        assert "401" in str(excinfo.value) or "unauth" in str(excinfo.value).lower()


# ── send_heartbeat ──────────────────────────────────────────────────


def test_send_heartbeat_posts_to_correct_url():
    client = FlexDashcamClient(BASE_URL, SECRET)
    with patch.object(client._session, "post", return_value=_ok_response({"ok": True})) as mock_post:
        client.send_heartbeat(unit_id=12, device_id="jetson-12")
    url, _, _ = _capture_request(mock_post)
    assert url == f"{BASE_URL}/api/dashcam-ai/heartbeat"


def test_send_heartbeat_serializes_health_metrics():
    client = FlexDashcamClient(BASE_URL, SECRET)
    with patch.object(client._session, "post", return_value=_ok_response({"ok": True})) as mock_post:
        client.send_heartbeat(
            unit_id=12,
            device_id="jetson-12",
            firmware_version="0.1.0",
            gpu_temp_c=56.4,
            cpu_temp_c=48.2,
            disk_used_pct=42.1,
            ram_used_pct=61.0,
            network_status="online",
            lte_rssi_dbm=-78,
            uptime_sec=12345,
        )
    _, _, body = _capture_request(mock_post)
    payload = json.loads(body)
    assert payload["unit_id"] == 12
    assert payload["device_id"] == "jetson-12"
    assert payload["firmware_version"] == "0.1.0"
    assert payload["gpu_temp_c"] == 56.4
    assert payload["network_status"] == "online"


def test_send_heartbeat_signature_validates():
    client = FlexDashcamClient(BASE_URL, SECRET)
    with patch.object(client._session, "post", return_value=_ok_response({"ok": True})) as mock_post:
        client.send_heartbeat(unit_id=12, device_id="jetson-12")
    _, headers, body = _capture_request(mock_post)
    ts = int(headers["X-Dashcam-Timestamp"])
    expected_sig = sign_payload(SECRET, ts, body)
    assert headers["X-Dashcam-Signature"] == expected_sig

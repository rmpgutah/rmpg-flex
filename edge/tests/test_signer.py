"""HMAC signer tests — must match server/src/utils/dashcamAiHmac.ts exactly.

If a fixture in this file ever drifts from a corresponding TS test in the
server, the edge runner will start producing signatures the server rejects,
and we'll spend hours debugging "why is auth failing" — so the fixtures here
are intentionally redundant with the TS side. Both speak HMAC-SHA256 over
`f"{ts}\\n{body}"` (timestamp, then literal newline, then raw body bytes).
"""
import hmac
import hashlib
import time
import pytest

from flex_edge.signer import sign_payload, REPLAY_WINDOW_SEC


SECRET = "test-shared-secret-must-be-32-chars-minimum"
RAW = b'{"event_type":"fcw","unit_id":7}'


def test_sign_payload_returns_sha256_prefix_and_64_hex_chars():
    sig = sign_payload(SECRET, 1745798400, RAW)
    assert sig.startswith("sha256=")
    digest = sig[len("sha256="):]
    assert len(digest) == 64
    assert all(c in "0123456789abcdef" for c in digest)


def test_sign_payload_matches_known_fixture():
    """Known fixture — recomputed from the canonical algorithm.

    If you change the framing in signer.py, this test breaks loudly
    AND the server will reject signatures from this runner. Both
    sides must agree on the byte-level layout: timestamp string, '\\n',
    body bytes.
    """
    ts = 1745798400
    h = hmac.new(SECRET.encode(), digestmod=hashlib.sha256)
    h.update(str(ts).encode())
    h.update(b"\n")
    h.update(RAW)
    expected = "sha256=" + h.hexdigest()
    assert sign_payload(SECRET, ts, RAW) == expected


def test_sign_payload_is_deterministic():
    a = sign_payload(SECRET, 1745798400, RAW)
    b = sign_payload(SECRET, 1745798400, RAW)
    assert a == b


def test_sign_payload_changes_with_timestamp():
    a = sign_payload(SECRET, 1745798400, RAW)
    b = sign_payload(SECRET, 1745798401, RAW)
    assert a != b


def test_sign_payload_changes_with_body():
    a = sign_payload(SECRET, 1745798400, RAW)
    b = sign_payload(SECRET, 1745798400, b'{"event_type":"fcw","unit_id":8}')
    assert a != b


def test_sign_payload_changes_with_secret():
    a = sign_payload(SECRET, 1745798400, RAW)
    b = sign_payload("attacker-guessed", 1745798400, RAW)
    assert a != b


def test_replay_window_is_300_seconds():
    """Must match server's REPLAY_WINDOW_SEC. If we drift, edges
    that signed correctly per their clock get rejected."""
    assert REPLAY_WINDOW_SEC == 300


def test_sign_payload_accepts_str_or_bytes_body():
    """Convenience: callers may pass str (UTF-8) or bytes."""
    a = sign_payload(SECRET, 1745798400, RAW)
    b = sign_payload(SECRET, 1745798400, RAW.decode("utf-8"))
    assert a == b

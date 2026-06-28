"""HMAC-SHA256 signed-body signer for Flex Dashcam AI webhooks.

Cross-language contract — must match server/src/utils/dashcamAiHmac.ts
byte-for-byte. The signed payload is:

    f"{timestamp}\\n{raw_body}".encode()

then HMAC-SHA256'd with the shared secret, hex-encoded, and prefixed
with "sha256=". Header layout sent over HTTP:

    X-Dashcam-Timestamp: <unix-seconds>
    X-Dashcam-Signature: sha256=<hexdigest>

The server rejects timestamps outside ±REPLAY_WINDOW_SEC of its own
clock, so this module exposes that constant for symmetry — callers
should always sign with `int(time.time())` as the timestamp.
"""
from __future__ import annotations

import hashlib
import hmac
from typing import Union

# Must match server's REPLAY_WINDOW_SEC. If you change it, change both
# sides in the same PR or you'll desync edge fleets across deploys.
REPLAY_WINDOW_SEC: int = 300


def sign_payload(secret: str, timestamp: int, body: Union[bytes, str]) -> str:
    """Compute the X-Dashcam-Signature header value for a request.

    Parameters
    ----------
    secret:
        Shared secret. Must match server's DASHCAM_FORWARD_SECRET env var.
    timestamp:
        Unix timestamp in **seconds** (not ms). Use int(time.time()).
    body:
        The exact bytes the HTTP client will send as the request body.
        If passed as str, it's encoded UTF-8 — but for fidelity in
        production code prefer pre-serializing to bytes once and using
        those bytes both here and in the request body, to avoid any
        encoding round-trip surprises.

    Returns
    -------
    str
        ``"sha256=<64-hex-chars>"`` — set this as the
        ``X-Dashcam-Signature`` HTTP header.
    """
    if isinstance(body, str):
        body_bytes = body.encode("utf-8")
    else:
        body_bytes = body

    h = hmac.new(secret.encode("utf-8"), digestmod=hashlib.sha256)
    h.update(str(timestamp).encode("ascii"))
    h.update(b"\n")
    h.update(body_bytes)
    return "sha256=" + h.hexdigest()

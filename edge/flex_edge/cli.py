"""flex-edge command-line interface.

Subcommands:
    flex-edge send-event      POST a single driving event
    flex-edge heartbeat       POST a fleet-health heartbeat
    flex-edge simulate        Stream synthetic events at a configurable rate

All commands read FLEX_BASE_URL and FLEX_DASHCAM_SECRET from the
environment unless overridden by --base-url / --secret flags. The
secret is *intentionally* not a default-on flag so you don't
accidentally leak it via shell history when copy-pasting commands.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

import click

from flex_edge.client import FlexDashcamClient, FlexDashcamHttpError
from flex_edge.simulator import SimulatorConfig, run_simulation


def _make_client(base_url: Optional[str], secret: Optional[str]) -> FlexDashcamClient:
    base = base_url or os.environ.get("FLEX_BASE_URL")
    sec = secret or os.environ.get("FLEX_DASHCAM_SECRET")
    if not base:
        click.echo("error: --base-url or FLEX_BASE_URL is required", err=True)
        sys.exit(2)
    if not sec:
        click.echo("error: --secret or FLEX_DASHCAM_SECRET is required", err=True)
        sys.exit(2)
    return FlexDashcamClient(base, sec)


@click.group()
@click.version_option(package_name="flex-edge")
def main() -> None:
    """flex-edge — RMPG Flex Dashcam AI edge runner."""


@main.command("send-event")
@click.option("--base-url", help="Flex base URL (default: env FLEX_BASE_URL)")
@click.option("--secret", help="Shared secret (default: env FLEX_DASHCAM_SECRET)")
@click.option("--unit-id", type=int, required=True, help="RMPG units.id")
@click.option("--device-id", required=True, help="Device identifier (e.g. jetson-12)")
@click.option(
    "--type", "event_type", required=True,
    type=click.Choice([
        "hard_brake", "hard_accel", "hard_turn", "impact",
        "fcw", "ldw", "tailgate", "pedestrian",
        "drowsy", "distracted", "phone_use", "seatbelt_off",
        "speeding", "overspeed_zone", "route_deviation",
        "ignition_on", "ignition_off", "idle_excessive", "dtc_set",
        "panic", "sos", "man_down",
        "k9_deploy", "weapon_draw", "use_of_force", "pursuit_start", "pursuit_end",
        "custom",
    ]),
    help="Normalized event_type (matches server's DrivingEventType)",
)
@click.option("--severity", type=click.Choice(["info", "warning", "alert", "critical"]), default="info")
@click.option("--lat", type=float, help="Latitude")
@click.option("--lng", type=float, help="Longitude")
@click.option("--speed", type=float, help="Speed in mph")
@click.option("--clip", type=click.Path(exists=True, dir_okay=False, path_type=Path), help="Path to clip file")
@click.option("--source-event-id", help="Vendor-side dedup key (recommended)")
@click.option("--model-version", help="Model version that triggered the event")
@click.option("--confidence", type=float, help="Detector confidence 0..1")
def send_event_cmd(
    base_url: Optional[str], secret: Optional[str],
    unit_id: int, device_id: str, event_type: str, severity: str,
    lat: Optional[float], lng: Optional[float], speed: Optional[float],
    clip: Optional[Path], source_event_id: Optional[str],
    model_version: Optional[str], confidence: Optional[float],
) -> None:
    """Send a single driving event."""
    from datetime import datetime

    client = _make_client(base_url, secret)
    clip_bytes = clip.read_bytes() if clip else None
    clip_filename = clip.name if clip else None
    try:
        result = client.send_event(
            event_type=event_type,
            event_timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            unit_id=unit_id,
            device_id=device_id,
            severity=severity,
            source_event_id=source_event_id,
            latitude=lat,
            longitude=lng,
            speed_mph=speed,
            model_version=model_version,
            confidence=confidence,
            clip=clip_bytes,
            clip_filename=clip_filename,
        )
        click.echo(f"ok: event_id={result.get('event_id')} evidence_id={result.get('evidence_id')} deduped={result.get('deduped')}")
    except FlexDashcamHttpError as e:
        click.echo(f"error: {e}", err=True)
        sys.exit(1)


@main.command("heartbeat")
@click.option("--base-url", help="Flex base URL (default: env FLEX_BASE_URL)")
@click.option("--secret", help="Shared secret (default: env FLEX_DASHCAM_SECRET)")
@click.option("--unit-id", type=int, required=True)
@click.option("--device-id", required=True)
@click.option("--device-kind", default="flex_ai")
@click.option("--firmware-version")
@click.option("--gpu-temp", "gpu_temp_c", type=float)
@click.option("--cpu-temp", "cpu_temp_c", type=float)
@click.option("--disk-pct", "disk_used_pct", type=float)
@click.option("--ram-pct", "ram_used_pct", type=float)
@click.option("--network", "network_status", type=click.Choice(["online", "offline", "degraded"]))
def heartbeat_cmd(
    base_url: Optional[str], secret: Optional[str],
    unit_id: int, device_id: str, device_kind: str,
    firmware_version: Optional[str],
    gpu_temp_c: Optional[float], cpu_temp_c: Optional[float],
    disk_used_pct: Optional[float], ram_used_pct: Optional[float],
    network_status: Optional[str],
) -> None:
    """Send a fleet-health heartbeat."""
    client = _make_client(base_url, secret)
    try:
        result = client.send_heartbeat(
            unit_id=unit_id, device_id=device_id, device_kind=device_kind,
            firmware_version=firmware_version,
            gpu_temp_c=gpu_temp_c, cpu_temp_c=cpu_temp_c,
            disk_used_pct=disk_used_pct, ram_used_pct=ram_used_pct,
            network_status=network_status,
        )
        click.echo(f"ok: {result}")
    except FlexDashcamHttpError as e:
        click.echo(f"error: {e}", err=True)
        sys.exit(1)


@main.command("simulate")
@click.option("--base-url", help="Flex base URL (default: env FLEX_BASE_URL)")
@click.option("--secret", help="Shared secret (default: env FLEX_DASHCAM_SECRET)")
@click.option("--unit-ids", required=True, help="Comma-separated unit IDs (e.g. 12,7,3)")
@click.option("--rate", type=float, default=1.0, help="Events per second across all units")
@click.option("--duration", type=float, help="Stop after N seconds (default: run until interrupted)")
@click.option("--clips", is_flag=True, help="Include synthetic clip bytes (~64KB each)")
@click.option("--seed", type=int, help="RNG seed for reproducible runs")
def simulate_cmd(
    base_url: Optional[str], secret: Optional[str],
    unit_ids: str, rate: float, duration: Optional[float], clips: bool, seed: Optional[int],
) -> None:
    """Stream synthetic events to Flex (no hardware required)."""
    client = _make_client(base_url, secret)
    parsed_ids = [int(x.strip()) for x in unit_ids.split(",") if x.strip()]
    config = SimulatorConfig(
        unit_ids=parsed_ids,
        rate_per_sec=rate,
        duration_sec=duration,
        include_clips=clips,
        seed=seed,
    )
    click.echo(f"simulating: units={parsed_ids} rate={rate}/s duration={duration or 'until interrupted'} clips={clips}")
    try:
        for i, result in enumerate(run_simulation(client, config), start=1):
            tag = "OK " if "server_response" in result else "ERR"
            click.echo(f"[{i:5d}] {tag} unit={result['unit_id']} type={result['event_type']:<14} sev={result['severity']:<8} {result.get('error', '')}")
    except KeyboardInterrupt:
        click.echo("\ninterrupted")


if __name__ == "__main__":
    main()

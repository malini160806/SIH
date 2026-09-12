"""
Sensor-fusion module.

Combines radar, thermal-camera, V2V and GPS evidence about the vehicle
ahead into a single fused detection with a HIGH/MEDIUM/LOW/NONE
confidence rating, and reports exactly which sensors contributed —
this is what the dashboard shows under "Fusion result".
"""
from __future__ import annotations

from .models import FusionResult, RadarReading, ThermalReading, V2VMessage


def fuse(
    radar: RadarReading,
    thermal: ThermalReading,
    v2v_message: V2VMessage | None,
    ahead_id: str | None,
    gap_m: float | None,
) -> FusionResult:
    contributing: list[str] = []

    if radar.get("detected"):
        contributing.append("radar")
    if thermal.get("detected"):
        contributing.append("thermal")
    if v2v_message is not None:
        # a V2V broadcast carries the other vehicle's own GPS-derived position
        contributing.append("v2v")
        contributing.append("gps")

    score = len(contributing)
    if score == 0:
        confidence = "NONE"
    elif score == 1:
        confidence = "LOW"
    elif score == 2:
        confidence = "MEDIUM"
    else:
        confidence = "HIGH"

    return FusionResult(
        detected=score > 0,
        confidence=confidence,
        contributing_sensors=contributing,
        target_id=ahead_id if score > 0 else None,
        distance_m=gap_m if score > 0 else None,
    )

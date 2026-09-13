"""
Sensor-fusion module.

Combines radar RANGE + thermal HEAT/centroid-ANGLE + a V2V broadcast
(which itself carries the other vehicle's own RTK/dead-reckoned
position) into one fused detection with a HIGH/MEDIUM/LOW/NONE
confidence rating, reporting exactly which sensors contributed.
"""
from __future__ import annotations

from .models import FusionResult


def fuse(radar: dict, thermal: dict, v2v_message, other_id: str | None, gap_m: float | None) -> FusionResult:
    contributing: list[str] = []

    if radar.get("detected"):
        contributing.append("radar")
    if thermal.get("detected"):
        contributing.append("thermal")
    if v2v_message is not None:
        contributing.append("v2v")

    score = len(contributing)
    confidence = {0: "NONE", 1: "LOW", 2: "MEDIUM"}.get(score, "HIGH")

    return FusionResult(
        detected=score > 0,
        confidence=confidence,
        contributing_sensors=contributing,
        target_id=other_id if score > 0 else None,
        range_m=round(gap_m, 1) if (score > 0 and gap_m is not None) else None,
        centroid_angle_deg=thermal.get("centroid_angle_deg") if thermal.get("detected") else None,
    )

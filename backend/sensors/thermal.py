"""LWIR thermal array simulation.

Thermal answers a different question than radar: WHERE IS THE HEAT
SOURCE RELATIVE TO MY VEHICLE? It reports a heat centroid *angle*
(bearing relative to the truck's own heading) and a coarse direction
label, plus confidence — never a distance. Thermal also keeps working
reasonably well in fog, unlike a visible-light camera, so its
detection range is only mildly cut in extreme fog.
"""
from __future__ import annotations

import math
import random

from .base import SensorInterface
from ..models import ThermalReading


def _direction_label(angle_deg: float) -> str:
    a = abs(angle_deg)
    side = "Right" if angle_deg >= 0 else "Left"
    if a <= 20:
        return "Front"
    if a <= 70:
        return f"Front {side}"
    if a <= 110:
        return side
    if a <= 160:
        return f"Rear {side}"
    return "Rear"


class ThermalCameraSim(SensorInterface):
    def __init__(self, thermal_range_m: float, base_confidence: float):
        self.thermal_range_m = thermal_range_m
        self.base_confidence = base_confidence

    def read(self, context: dict) -> dict:
        gap_m = context.get("gap_m")
        visibility_m = context.get("visibility_m", 200)
        self_x, self_y = context.get("self_x"), context.get("self_y")
        other_x, other_y = context.get("other_x"), context.get("other_y")
        self_heading_deg = context.get("self_heading_deg", 0.0)

        effective_range = self.thermal_range_m * (0.6 if visibility_m < 10 else 1.0)

        if gap_m is None or gap_m > effective_range or other_x is None:
            return ThermalReading(detected=False).to_dict()

        bearing = math.degrees(math.atan2(other_y - self_y, other_x - self_x))
        centroid_angle = ((bearing - self_heading_deg + 180) % 360) - 180
        centroid_angle += random.gauss(0, 3)

        distance_falloff = (gap_m / effective_range) * 30
        confidence = max(40.0, self.base_confidence - distance_falloff + random.uniform(-3, 3))

        return ThermalReading(
            detected=True,
            confidence=round(confidence, 1),
            centroid_angle_deg=round(centroid_angle, 1),
            direction=_direction_label(centroid_angle),
        ).to_dict()

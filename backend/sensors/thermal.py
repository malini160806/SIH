"""Thermal camera simulation.

Thermal imaging keeps working reasonably well in fog (unlike a normal
visible-light camera), so its detection range is only mildly reduced by
poor visibility, and confidence decays gently with distance rather than
collapsing outright.
"""
from __future__ import annotations

import random

from .base import SensorInterface
from ..models import ThermalReading


class ThermalCameraSim(SensorInterface):
    def __init__(self, thermal_range_m: float, base_confidence: float):
        self.thermal_range_m = thermal_range_m
        self.base_confidence = base_confidence

    def read(self, context: dict) -> dict:
        gap_m = context.get("gap_m")
        visibility_m = context.get("visibility_m", 200)

        # extreme fog fogs the lens slightly even for thermal -> small range cut
        effective_range = self.thermal_range_m * (0.6 if visibility_m < 10 else 1.0)

        if gap_m is None or gap_m > effective_range:
            return ThermalReading(detected=False).to_dict()

        distance_falloff = (gap_m / effective_range) * 30
        confidence = max(40.0, self.base_confidence - distance_falloff + random.uniform(-3, 3))
        return ThermalReading(detected=True, confidence=round(confidence, 1)).to_dict()

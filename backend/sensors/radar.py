"""mmWave radar simulation.

Real mmWave radar (e.g. TI IWR6843) reports object range and Doppler
(relative velocity) largely unaffected by fog. We simulate the same
contract: within `radar_range_m` the vehicle ahead is detected with a
small amount of measurement noise; beyond that, nothing is seen.
"""
from __future__ import annotations

import random

from .base import SensorInterface
from ..models import RadarReading


class MMWaveRadarSim(SensorInterface):
    def __init__(self, radar_range_m: float, distance_noise_m: float, speed_noise_mps: float):
        self.radar_range_m = radar_range_m
        self.distance_noise_m = distance_noise_m
        self.speed_noise_mps = speed_noise_mps

    def read(self, context: dict) -> dict:
        gap_m = context.get("gap_m")
        closing_speed_mps = context.get("closing_speed_mps", 0.0)

        if gap_m is None or gap_m > self.radar_range_m:
            return RadarReading(detected=False).to_dict()

        noisy_distance = max(0.0, gap_m + random.gauss(0, self.distance_noise_m))
        noisy_speed = closing_speed_mps + random.gauss(0, self.speed_noise_mps)
        return RadarReading(
            detected=True,
            distance_m=round(noisy_distance, 1),
            relative_speed_mps=round(noisy_speed, 2),
        ).to_dict()

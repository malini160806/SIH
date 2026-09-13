"""Wheel-speed sensor simulation — speed + cumulative odometry, always
available. This is one of the two inputs (with IMU heading) used for
kinematic dead reckoning when RTK-GNSS is lost."""
from __future__ import annotations

import random

from .base import SensorInterface
from ..models import WheelSpeedReading


class WheelSpeedSim(SensorInterface):
    def __init__(self, noise_kmh: float):
        self.noise_kmh = noise_kmh

    def read(self, context: dict) -> dict:
        speed = max(0.0, context["speed_kmh"] + random.gauss(0, self.noise_kmh))
        return WheelSpeedReading(
            speed_kmh=round(speed, 1),
            odometry_m=round(context["odometry_m"], 1),
            travel_direction=context.get("travel_direction", "Stationary"),
            status="ACTIVE",
        ).to_dict()

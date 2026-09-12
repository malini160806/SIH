"""IMU simulation — acceleration, angular velocity (yaw rate) and heading."""
from __future__ import annotations

import random

from .base import SensorInterface
from ..models import IMUReading


class IMUSim(SensorInterface):
    def __init__(self, noise: float):
        self.noise = noise
        self._prev_heading: dict[str, float] = {}

    def read(self, context: dict) -> dict:
        vid = context["vehicle_id"]
        heading = context["heading_deg"]
        dt = context.get("dt", 0.4)
        prev = self._prev_heading.get(vid, heading)
        angular_velocity = ((heading - prev + 180) % 360 - 180) / dt if dt > 0 else 0.0
        self._prev_heading[vid] = heading

        accel = context.get("accel_mps2", 0.0) + random.gauss(0, self.noise)
        return IMUReading(
            acceleration_mps2=round(accel, 2),
            angular_velocity_dps=round(angular_velocity + random.gauss(0, self.noise), 2),
            heading_deg=round(heading + random.gauss(0, self.noise), 1),
        ).to_dict()

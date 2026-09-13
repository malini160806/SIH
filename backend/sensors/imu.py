"""
MEMS IMU simulation.

Every value here is derived from the vehicle's actual simulated motion:
  * heading_deg     — the vehicle's real current heading
  * yaw_rate_deg_s  — the REAL angular velocity, computed from how much
                       that heading actually changed since the last tick
                       (shortest-path angle difference / dt) — so it
                       genuinely spikes on curves and sits near zero on
                       straights, exactly as a real gyro would.
  * acceleration_mps2 — the vehicle's real longitudinal acceleration
  * orientation     — flags a "TILT WARNING" only when the vehicle's
                       simulated lateral road-edge drift signal gets
                       large (the same signal the road-edge emergency
                       detector watches), not a random value
  * motion_state    — derived from current speed and acceleration sign
No field is ever generated independently of the vehicle's own motion.
"""
from __future__ import annotations

import random

from .base import SensorInterface
from ..models import IMUReading


class IMUSim(SensorInterface):
    def __init__(self, noise: float, tilt_warning_threshold: float = 0.75):
        self.noise = noise
        self.tilt_warning_threshold = tilt_warning_threshold
        self._prev_heading: dict[str, float] = {}

    def read(self, context: dict) -> dict:
        vid = context["vehicle_id"]
        heading = context["heading_deg"]
        dt = context.get("dt", 0.4)

        prev = self._prev_heading.get(vid, heading)
        # shortest-path angular difference, so wraparound (359 -> 1) doesn't
        # register as a huge false yaw spike
        delta = ((heading - prev + 180) % 360) - 180
        yaw_rate = (delta / dt) if dt > 0 else 0.0
        self._prev_heading[vid] = heading

        speed_kmh = context.get("speed_kmh", 0.0)
        accel = context.get("accel_mps2", 0.0)
        stalled = context.get("stalled", False)
        lateral_offset = context.get("lateral_offset", 0.0)

        if speed_kmh < 0.3:
            motion_state = "STATIONARY"
        elif accel > 0.08:
            motion_state = "ACCELERATING"
        elif accel < -0.08:
            motion_state = "DECELERATING"
        else:
            motion_state = "CRUISING"

        orientation = "TILT WARNING" if abs(lateral_offset) >= self.tilt_warning_threshold else "STABLE"
        status = "WARNING" if (stalled or orientation == "TILT WARNING") else "ACTIVE"

        return IMUReading(
            status=status,
            heading_deg=round(heading + random.gauss(0, self.noise), 1),
            yaw_rate_deg_s=round(yaw_rate + random.gauss(0, self.noise * 2), 1),
            acceleration_mps2=round(accel + random.gauss(0, self.noise), 2),
            orientation=orientation,
            motion_state=motion_state,
        ).to_dict()

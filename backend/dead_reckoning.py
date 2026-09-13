"""
Novelty 3 — Low-cost IMU + wheel-speed kinematic dead reckoning.

Normal operation fuses RTK-GNSS (absolute position) + IMU (heading) +
wheel-speed (odometry). When RTK-GNSS is lost, position estimation
does not stop: it falls back to integrating wheel-speed and IMU
heading forward from the last known RTK fix.

    LAST KNOWN POSITION
            +
    WHEEL MOVEMENT (speed * dt)
            +
    IMU HEADING
            ↓
    KINEMATIC DEAD RECKONING
            ↓
    ESTIMATED CURRENT POSITION

Each estimate carries a small amount of integration error (from wheel
and IMU sensor noise) that accumulates the longer RTK stays down —
authentic to real dead reckoning. The moment RTK-GNSS is restored, the
estimate re-synchronizes to the fresh fix instantly.
"""
from __future__ import annotations

import math

from .models import PositionEstimate


class DeadReckoning:
    def __init__(self):
        # per-vehicle running estimate + the true position at last RTK fix,
        # used only to report drift for the UI (how far the estimate has
        # wandered from ground truth while RTK has been down)
        self._estimate: dict[str, tuple[float, float]] = {}
        self._mode: dict[str, str] = {}
        self._distance_since_loss: dict[str, float] = {}

    def reset(self, vehicle_id: str, x: float, y: float):
        """Snap the cached estimate to a known-good position — used when a
        demo script repositions a vehicle directly, so the next dead
        reckoning step doesn't compute bogus drift against a stale cache."""
        self._estimate[vehicle_id] = (x, y)
        self._distance_since_loss[vehicle_id] = 0.0

    def update(self, vehicle_id: str, rtk_reading: dict, imu_reading: dict,
               wheel_reading: dict, dt: float, true_x: float, true_y: float) -> PositionEstimate:
        if rtk_reading.get("status") == "ACTIVE":
            x, y = rtk_reading["x"], rtk_reading["y"]
            self._estimate[vehicle_id] = (x, y)
            self._mode[vehicle_id] = "RTK"
            self._distance_since_loss[vehicle_id] = 0.0
            return PositionEstimate(x=x, y=y, mode="RTK", drift_m=0.0, distance_since_loss_m=0.0)

        # RTK lost: integrate wheel-speed odometry along the IMU heading,
        # starting from wherever the estimate last was (the last RTK fix,
        # or the previous dead-reckoning step)
        last = self._estimate.get(vehicle_id, (true_x, true_y))
        heading_rad = math.radians(imu_reading["heading_deg"])
        distance_m = (wheel_reading["speed_kmh"] / 3.6) * dt
        est_x = last[0] + distance_m * math.cos(heading_rad)
        est_y = last[1] + distance_m * math.sin(heading_rad)
        self._estimate[vehicle_id] = (est_x, est_y)
        self._mode[vehicle_id] = "DEAD_RECKONING"
        self._distance_since_loss[vehicle_id] = self._distance_since_loss.get(vehicle_id, 0.0) + distance_m

        drift_m = math.hypot(est_x - true_x, est_y - true_y)
        return PositionEstimate(
            x=est_x, y=est_y, mode="DEAD_RECKONING", drift_m=round(drift_m, 2),
            distance_since_loss_m=round(self._distance_since_loss[vehicle_id], 1),
        )

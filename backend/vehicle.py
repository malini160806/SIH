"""
Vehicle state + the manager that advances every truck each simulation tick.

Movement model: each vehicle tracks a scalar arc-length position `s`
along the RoadNetwork loop. Actual speed eases towards
min(driver_target_speed, recommended_safe_speed) using a comfortable
accel/decel limit, which is what lets the dynamic-safe-speed advisory
visibly slow vehicles down in the simulation instead of just being a
number on the dashboard.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field

from .road_network import RoadNetwork


@dataclass
class Vehicle:
    vehicle_id: str
    s: float                     # arc-length position (m)
    target_speed_kmh: float      # "driver intent" cruising speed
    speed_kmh: float = 0.0       # actual current speed
    heading_deg: float = 0.0
    accel_mps2: float = 0.0
    hazard_status: str = "GREEN"
    comm_ok: bool = True         # False simulates V2V comm loss
    stalled: bool = False        # True simulates breakdown
    lateral_offset: float = 0.0  # simulated road-edge drift signal
    ignore_speed_advisory: bool = False  # demo-only: driver hasn't reacted to the warning yet
    x: float = 0.0
    y: float = 0.0
    zone_type: str = "straight"
    zone_name: str = "Straight Road"
    _prev_speed_kmh: float = field(default=0.0, repr=False)

    def to_dict(self):
        return {
            "id": self.vehicle_id,
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "s": round(self.s, 1),
            "speed_kmh": round(self.speed_kmh, 1),
            "target_speed_kmh": round(self.target_speed_kmh, 1),
            "heading_deg": round(self.heading_deg, 1),
            "accel_mps2": round(self.accel_mps2, 2),
            "hazard_status": self.hazard_status,
            "comm_ok": self.comm_ok,
            "stalled": self.stalled,
            "zone_type": self.zone_type,
            "zone_name": self.zone_name,
        }


class VehicleManager:
    def __init__(self, road: RoadNetwork, ids: list[str], target_speeds: list[float]):
        self.road = road
        self.vehicles: dict[str, Vehicle] = {}
        spacing = road.total_length / max(len(ids), 1)
        for i, vid in enumerate(ids):
            v = Vehicle(
                vehicle_id=vid,
                s=i * spacing,
                target_speed_kmh=target_speeds[i % len(target_speeds)],
                speed_kmh=target_speeds[i % len(target_speeds)] * 0.6,
            )
            self._place(v)
            self.vehicles[vid] = v

    def _place(self, v: Vehicle):
        v.x, v.y = self.road.point_at_s(v.s)
        v.heading_deg = self.road.heading_at_s(v.s)
        zone = self.road.zone_at_s(v.s)
        v.zone_type = zone.zone_type
        v.zone_name = zone.name

    def ordered_ids(self) -> list[str]:
        return sorted(self.vehicles, key=lambda vid: self.vehicles[vid].s)

    def gap_ahead(self, vehicle_id: str) -> tuple[str | None, float | None]:
        """Nearest vehicle ahead on the loop and the gap distance (m)."""
        me = self.vehicles[vehicle_id]
        best_id, best_gap = None, None
        for other_id, other in self.vehicles.items():
            if other_id == vehicle_id:
                continue
            gap = self.road.gap_ahead(me.s, other.s)
            if best_gap is None or gap < best_gap:
                best_gap, best_id = gap, other_id
        return best_id, best_gap

    def step(self, dt: float, recommended_speed: dict[str, float], max_accel: float, max_decel: float):
        for v in self.vehicles.values():
            v._prev_speed_kmh = v.speed_kmh

            if v.stalled:
                v.speed_kmh = 0.0
                v.accel_mps2 = 0.0
                continue

            if v.ignore_speed_advisory:
                desired = v.target_speed_kmh
            else:
                cap = recommended_speed.get(v.vehicle_id, v.target_speed_kmh)
                desired = min(v.target_speed_kmh, cap)
            current_mps = v.speed_kmh / 3.6
            desired_mps = max(desired, 0) / 3.6
            diff = desired_mps - current_mps
            max_delta = (max_accel if diff > 0 else max_decel) * dt
            step = max(-abs(max_delta), min(abs(max_delta), diff))
            new_mps = max(0.0, current_mps + step)
            v.accel_mps2 = (new_mps - current_mps) / dt if dt > 0 else 0.0
            v.speed_kmh = new_mps * 3.6

            v.s = self.road.wrap(v.s + new_mps * dt)
            self._place(v)

            # tiny random walk to give the "road edge" emergency detector
            # something to occasionally trip on
            v.lateral_offset += random.uniform(-0.05, 0.05)
            v.lateral_offset = max(-1.0, min(1.0, v.lateral_offset))

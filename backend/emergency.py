"""
Emergency detection.

Runs simple per-tick rule checks against each vehicle's state history:
  * sudden stopping     - large one-tick speed drop
  * collision           - extremely small gap while still closing
  * breakdown           - stalled (speed ~0) for longer than a threshold
  * communication loss  - V2V broadcast flag down beyond a timeout
  * road-edge approach  - simulated lateral drift signal crosses a limit

Each detected condition produces one EmergencyEvent, which the
simulation engine logs to SQLite and pushes to the dashboard.
"""
from __future__ import annotations

import random

from .models import EmergencyEvent
from .vehicle import Vehicle


class EmergencyDetector:
    def __init__(self, cfg: dict):
        self.sudden_stop_drop_kmh = cfg["sudden_stop_drop_kmh"]
        self.breakdown_stall_seconds = cfg["breakdown_stall_seconds"]
        self.comm_loss_timeout_s = cfg["comm_loss_timeout_s"]
        self.collision_distance_m = cfg["collision_distance_m"]
        self.road_edge_probability = cfg["road_edge_probability_per_tick"]

        self._stall_timers: dict[str, float] = {}
        self._comm_loss_timers: dict[str, float] = {}
        self._last_event_type: dict[str, str] = {}

    def check(
        self,
        vehicle: Vehicle,
        dt: float,
        gap_m: float | None,
        closing_speed_mps: float,
        zone_name: str,
    ) -> list[EmergencyEvent]:
        events: list[EmergencyEvent] = []
        vid = vehicle.vehicle_id

        # sudden stopping
        drop = vehicle._prev_speed_kmh - vehicle.speed_kmh
        if drop >= self.sudden_stop_drop_kmh and vehicle._prev_speed_kmh > 5 and not vehicle.stalled:
            events.append(EmergencyEvent("SUDDEN_STOP", vid, zone_name, "Sudden deceleration detected"))

        # collision risk realised
        if gap_m is not None and gap_m <= self.collision_distance_m and closing_speed_mps > 0.1:
            events.append(EmergencyEvent("COLLISION", vid, zone_name, "Collision risk imminent"))

        # breakdown (stalled)
        if vehicle.stalled:
            self._stall_timers[vid] = self._stall_timers.get(vid, 0.0) + dt
            if self._stall_timers[vid] >= self.breakdown_stall_seconds:
                events.append(EmergencyEvent("BREAKDOWN", vid, zone_name, "Possible breakdown"))
        else:
            self._stall_timers[vid] = 0.0

        # communication loss
        if not vehicle.comm_ok:
            self._comm_loss_timers[vid] = self._comm_loss_timers.get(vid, 0.0) + dt
            if self._comm_loss_timers[vid] >= self.comm_loss_timeout_s:
                events.append(EmergencyEvent("COMM_LOSS", vid, zone_name, "V2V communication lost"))
        else:
            self._comm_loss_timers[vid] = 0.0

        # road-edge approach (rare random trip, or forced via lateral_offset)
        if abs(vehicle.lateral_offset) > 0.9 or random.random() < self.road_edge_probability:
            events.append(EmergencyEvent("ROAD_EDGE", vid, zone_name, "Road-edge approach warning"))

        return events

"""
Vehicle state + the manager that runs the autonomous haul cycle for
every truck each simulation tick.

Each truck's *true* position is a single scalar `theta` along the
spiral RoadNetwork — this is what actually drives physics (speed,
curvature, elevation, zone). Absolute position (x/y) is reported
separately by the positioning stack (RTK-GNSS normally, kinematic dead
reckoning when RTK is lost) — see dead_reckoning.py. The truck's motion
along the road never depends on GPS, exactly like a real autonomous
haul truck that also has wheel-speed + IMU + a known road map; only the
*absolute position estimate* degrades when RTK is lost, which is the
thing Novelty 3 is meant to demonstrate.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field

from .road_network import RoadNetwork

PHASE_LOADING = "LOADING"
PHASE_LOADED_HAUL = "LOADED_HAUL"
PHASE_DUMPING = "DUMPING"
PHASE_EMPTY_RETURN = "EMPTY_RETURN"

PHASE_DESTINATION = {
    PHASE_LOADING: "Dumping Area",
    PHASE_LOADED_HAUL: "Dumping Area",
    PHASE_DUMPING: "Loading Area",
    PHASE_EMPTY_RETURN: "Loading Area",
}


@dataclass
class Vehicle:
    vehicle_id: str
    theta: float
    phase: str
    speed_factor: float = 1.0    # per-truck personality multiplier on the speed cap

    speed_kmh: float = 0.0
    accel_mps2: float = 0.0
    heading_deg: float = 0.0
    x: float = 0.0                 # TRUE ground-truth position (drives physics/rendering)
    y: float = 0.0
    elevation_m: float = 0.0
    bench: str = ""
    zone_type: str = "bench_road"
    zone_name: str = "Bench Road"

    odometry_m: float = 0.0
    phase_timer_s: float = 0.0
    stop_offset: float = 0.0    # per-truck stagger so queued trucks don't overlap

    hazard_status: str = "GREEN"
    comm_ok: bool = True            # False simulates V2V comm loss
    stalled: bool = False           # True simulates breakdown
    lateral_offset: float = 0.0     # simulated road-edge drift signal

    _prev_speed_kmh: float = field(default=0.0, repr=False)

    @property
    def loaded(self) -> bool:
        return self.phase in (PHASE_LOADING, PHASE_LOADED_HAUL)

    @property
    def direction_sign(self) -> int:
        if self.phase == PHASE_LOADED_HAUL:
            return -1
        if self.phase == PHASE_EMPTY_RETURN:
            return 1
        return 0

    @property
    def destination(self) -> str:
        return PHASE_DESTINATION[self.phase]

    @property
    def travel_direction_label(self) -> str:
        if self.stalled:
            return "Stopped (breakdown)"
        if self.direction_sign < 0:
            return "Ascending to Surface"
        if self.direction_sign > 0:
            return "Descending to Pit"
        return "Stationary (queued)"

    def to_dict(self):
        return {
            "id": self.vehicle_id,
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "theta": round(self.theta, 4),
            "elevation_m": round(self.elevation_m, 1),
            "bench": self.bench,
            "phase": self.phase,
            "destination": self.destination,
            "loaded": self.loaded,
            "speed_kmh": round(self.speed_kmh, 1),
            "heading_deg": round(self.heading_deg, 1),
            "accel_mps2": round(self.accel_mps2, 2),
            "odometry_m": round(self.odometry_m, 1),
            "hazard_status": self.hazard_status,
            "comm_ok": self.comm_ok,
            "stalled": self.stalled,
            "zone_type": self.zone_type,
            "zone_name": self.zone_name,
        }


class VehicleManager:
    def __init__(self, road: RoadNetwork, ids: list[str], haul_cfg: dict):
        self.road = road
        self.loading_pause_s = haul_cfg["loading_pause_s"]
        self.dumping_pause_s = haul_cfg["dumping_pause_s"]

        loading_mid = sum(road.loading_window) / 2
        dumping_mid = sum(road.dumping_window) / 2

        # staggered initial states so the fleet feels like a live operation
        # rather than five trucks moving in lockstep
        starts = [
            (PHASE_LOADING, loading_mid, 0.95),
            (PHASE_LOADED_HAUL, road.ramp_node_theta + 3.0, 1.05),
            (PHASE_EMPTY_RETURN, max(0.6, road.blind_curve_center - 3.0), 1.0),
            (PHASE_DUMPING, dumping_mid, 0.9),
            (PHASE_EMPTY_RETURN, road.intersection_theta + 2.0, 1.1),
        ]

        self.vehicles: dict[str, Vehicle] = {}
        for i, vid in enumerate(ids):
            phase, theta, factor = starts[i % len(starts)]
            stagger = (i - (len(ids) - 1) / 2) * 0.05
            if phase in (PHASE_LOADING, PHASE_DUMPING):
                theta += stagger
            v = Vehicle(vehicle_id=vid, theta=theta, phase=phase, speed_factor=factor, stop_offset=stagger)
            if phase in (PHASE_LOADING,):
                v.phase_timer_s = self.loading_pause_s
            elif phase in (PHASE_DUMPING,):
                v.phase_timer_s = self.dumping_pause_s
            self._place(v)
            self.vehicles[vid] = v

    def place(self, v: Vehicle):
        """Public sync point: recompute x/y/elevation/bench/zone/heading
        from v.theta. Call this after directly repositioning a vehicle
        (e.g. from demo.py) so the rest of this tick's sensor/positioning
        code sees consistent, up-to-date coordinates instead of stale
        ones left over from before the reposition."""
        self._place(v)

    def _place(self, v: Vehicle):
        v.x, v.y = self.road.point_at(v.theta)
        v.elevation_m = self.road.elevation_at(v.theta)
        v.bench = self.road.bench_at(v.theta)
        zone = self.road.zone_at(v.theta)
        v.zone_type = zone.zone_type
        v.zone_name = zone.name
        v.heading_deg = self.road.heading_at(v.theta, v.direction_sign or 1)

    def gap_to_nearest(self, vehicle_id: str) -> tuple[str | None, float | None]:
        """Nearest other vehicle by along-road distance (may be ahead, behind, or oncoming)."""
        me = self.vehicles[vehicle_id]
        best_id, best_gap = None, None
        for other_id, other in self.vehicles.items():
            if other_id == vehicle_id:
                continue
            gap = self.road.road_distance(me.theta, other.theta)
            if best_gap is None or gap < best_gap:
                best_gap, best_id = gap, other_id
        return best_id, best_gap

    def closing_speed(self, a_id: str, b_id: str) -> float:
        """Positive if the road-distance between a and b is currently shrinking."""
        a, b = self.vehicles[a_id], self.vehicles[b_id]
        r_a, r_b = self.road.radius_at(a.theta), self.road.radius_at(b.theta)
        omega_a = (a.speed_kmh / 3.6) / max(1.0, r_a) * a.direction_sign
        omega_b = (b.speed_kmh / 3.6) / max(1.0, r_b) * b.direction_sign
        d_theta = a.theta - b.theta
        rate = omega_a - omega_b
        if d_theta == 0:
            return max(0.0, -rate) * ((r_a + r_b) / 2)
        # gap (in theta) shrinks when sign(d_theta) opposes sign(rate)
        closing_rate = rate * (1 if d_theta > 0 else -1)
        if closing_rate >= 0:
            return 0.0
        return -closing_rate * ((r_a + r_b) / 2)

    def step(self, dt: float, recommended_speed: dict[str, float], max_accel: float, max_decel: float):
        for v in self.vehicles.values():
            v._prev_speed_kmh = v.speed_kmh

            if v.stalled:
                v.speed_kmh = 0.0
                v.accel_mps2 = 0.0
                continue

            if v.phase in (PHASE_LOADING, PHASE_DUMPING):
                v.speed_kmh = max(0.0, v.speed_kmh - max_decel * 3.6 * dt)
                v.phase_timer_s -= dt
                if v.phase_timer_s <= 0:
                    v.phase = PHASE_LOADED_HAUL if v.phase == PHASE_LOADING else PHASE_EMPTY_RETURN
                continue

            cap = recommended_speed.get(v.vehicle_id, 20.0)
            desired_mps = max(0.0, cap) / 3.6
            current_mps = v.speed_kmh / 3.6
            diff = desired_mps - current_mps
            max_delta = (max_accel if diff > 0 else max_decel) * dt
            step_delta = max(-abs(max_delta), min(abs(max_delta), diff))
            new_mps = max(0.0, current_mps + step_delta)
            v.accel_mps2 = (new_mps - current_mps) / dt if dt > 0 else 0.0
            v.speed_kmh = new_mps * 3.6

            distance_m = new_mps * dt
            v.odometry_m += distance_m
            radius = max(1.0, self.road.radius_at(v.theta))
            v.theta += v.direction_sign * (distance_m / radius)

            if v.phase == PHASE_LOADED_HAUL:
                dump_stop = sum(self.road.dumping_window) / 2 + v.stop_offset
                if v.theta <= dump_stop:
                    v.theta = dump_stop
                    v.phase = PHASE_DUMPING
                    v.phase_timer_s = self.dumping_pause_s
            elif v.phase == PHASE_EMPTY_RETURN:
                load_stop = sum(self.road.loading_window) / 2 + v.stop_offset
                if v.theta >= load_stop:
                    v.theta = load_stop
                    v.phase = PHASE_LOADING
                    v.phase_timer_s = self.loading_pause_s

            self._place(v)

            v.lateral_offset += random.uniform(-0.05, 0.05)
            v.lateral_offset = max(-1.0, min(1.0, v.lateral_offset))

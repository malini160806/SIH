"""
Novelty 2 — Dynamic Haul-Ramp Curve Speed Stabilization.

The recommended speed is derived from the *actual geometry* of the
road at the truck's current position — its local radius of curvature —
rather than a single fixed mine-wide speed. Named zones (blind curve,
intersection, loading, dumping, ramp) apply an additional hard cap on
top of the curvature-derived speed. Loaded trucks climbing out of the
pit are further slowed; empty trucks descending are allowed to move
a little faster — exactly like real haul-truck operating rules.

Combined with the accel/decel limits in VehicleManager.step(), this
produces the required smooth deceleration profile (22 -> 20 -> 17 ->
14 -> 11 -> 8 km/h) instead of an instant speed change.
"""
from __future__ import annotations

from .models import RiskAssessment


class SpeedAdvisor:
    def __init__(self, cfg: dict):
        self.curvature_k = cfg["curvature_k"]
        self.min_curve_speed = cfg["min_curve_speed_kmh"]
        self.max_speed = cfg["max_speed_kmh"]
        self.vis_factor = cfg["visibility_factor_kmh_per_m"]
        self.zone_caps = cfg["zone_caps"]
        self.loaded_factor = cfg["gradient_loaded_factor"]
        self.empty_factor = cfg["gradient_empty_factor"]
        self.traffic_penalty = cfg["traffic_density_penalty"]
        self.min_kmh = cfg["min_recommended_kmh"]

    def recommend(
        self,
        curvature_radius_m: float,
        zone_type: str,
        loaded: bool,
        visibility_m: float,
        risk: RiskAssessment,
        nearby_vehicle_count: int,
        speed_factor: float,
    ) -> float:
        # 1. curvature-derived base speed — the core novelty
        speed = max(self.min_curve_speed, min(self.max_speed, curvature_radius_m * self.curvature_k))

        # 2. named-zone hard cap (blind curve, intersection, loading, dumping, ramp)
        if zone_type in self.zone_caps:
            speed = min(speed, self.zone_caps[zone_type])

        # 3. gradient: loaded+ascending slower, empty+descending faster
        speed *= self.loaded_factor if loaded else self.empty_factor

        # 4. visibility-limited speed (fog)
        speed = min(speed, visibility_m * self.vis_factor)

        # 5. per-truck personality
        speed *= speed_factor

        # 6. local traffic density
        if nearby_vehicle_count >= 2:
            speed *= self.traffic_penalty

        # 7. collision risk overrides everything once it gets serious
        if risk.level == "RED":
            speed = 0.0
        elif risk.level == "ORANGE":
            speed = min(speed, 8.0)
        elif risk.level == "YELLOW":
            speed = min(speed, 15.0)

        return round(max(self.min_kmh, min(self.max_speed, speed)), 1)

"""
Dynamic safe-speed advisory.

Combines visibility, gap to the vehicle ahead, TTC, road curvature
(zone type), and local traffic density into one recommended speed
(km/h). All multipliers/weights are configurable in config.yaml.
"""
from __future__ import annotations

from .models import RiskAssessment


class SpeedAdvisor:
    def __init__(self, cfg: dict):
        self.vis_factor = cfg["visibility_factor_kmh_per_m"]
        self.zone_multiplier = cfg["zone_speed_multiplier"]
        self.traffic_penalty = cfg["traffic_density_penalty"]
        self.min_kmh = cfg["min_recommended_kmh"]
        self.max_kmh = cfg["absolute_max_kmh"]

    def recommend(
        self,
        visibility_m: float,
        current_speed_kmh: float,
        zone_type: str,
        risk: RiskAssessment,
        nearby_vehicle_count: int,
    ) -> float:
        # 1. visibility-limited speed - the core "can you stop in what you can see" rule
        speed = visibility_m * self.vis_factor

        # 2. road geometry - curves/intersections/loading-dumping areas are slower
        speed *= self.zone_multiplier.get(zone_type, 1.0)

        # 3. traffic density - following distance shrinks safety margin
        if nearby_vehicle_count >= 2:
            speed *= self.traffic_penalty

        # 4. TTC / collision risk overrides everything else once it gets serious
        if risk.level == "RED":
            speed = 0.0
        elif risk.level == "ORANGE":
            speed = min(speed, 8.0)
        elif risk.level == "YELLOW":
            speed = min(speed, 15.0)

        speed = max(self.min_kmh, min(self.max_kmh, speed))
        return round(speed, 1)

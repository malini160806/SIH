"""
Fleet-optimization / route-recommendation engine.

The mine's haul loop has one known fog-prone segment (the blind curve).
We model that as "Route A" and treat the rest of the loop as an
implicit "Route B" bypass for recommendation purposes. This is
intentionally simple, rule-based logic (per the brief) that can later
be replaced by a learned routing model without changing its interface.
"""
from __future__ import annotations

from .models import RiskAssessment
from .vehicle import Vehicle


class FleetOptimizer:
    def __init__(self, cfg: dict):
        self.fog_zone_name = cfg["fog_zone_name"]
        self.bypass_route_name = cfg["bypass_route_name"]

    def evaluate(
        self,
        fog_status: str,
        vehicles: dict[str, Vehicle],
        risks: dict[str, RiskAssessment],
    ) -> dict:
        route_a_risk = "LOW"
        if fog_status in ("HEAVY", "EXTREME"):
            route_a_risk = "HIGH"
        elif fog_status == "MEDIUM":
            route_a_risk = "MEDIUM"

        any_red = any(r.level == "RED" for r in risks.values())
        any_orange = any(r.level == "ORANGE" for r in risks.values())
        if any_red:
            route_a_risk = "HIGH"
        elif any_orange and route_a_risk == "LOW":
            route_a_risk = "MEDIUM"

        route_b_risk = "LOW"

        actions: list[str] = []
        vehicles_in_fog_zone = [v.vehicle_id for v in vehicles.values() if v.zone_type == "curve"]

        if route_a_risk == "HIGH":
            actions.append(f"Redirect vehicles to {self.bypass_route_name}.")
            if vehicles_in_fog_zone:
                actions.append(
                    f"Hold vehicle(s) {', '.join(vehicles_in_fog_zone)} until visibility improves."
                )
            actions.append("Reduce speed for all vehicles approaching the fog zone.")
            actions.append("Increase following distance to at least 60 m.")
        elif route_a_risk == "MEDIUM":
            actions.append("Reduce speed for vehicles in the blind-curve zone.")
            actions.append("Increase following distance to at least 40 m.")
        else:
            actions.append("Normal operations. No route changes required.")

        return {
            "route_a": {"name": self.fog_zone_name, "risk": route_a_risk},
            "route_b": {"name": self.bypass_route_name, "risk": route_b_risk},
            "recommendation": actions[0],
            "actions": actions,
        }

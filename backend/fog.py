"""
Fog controller.

Maintains one global visibility value (manual level, or auto
deterioration over time), then derives *spatial* visibility per mine
zone by applying a per-zone-type multiplier — the blind curve is
always the foggiest part of the mine relative to wherever else the
global preset currently sits, matching real microclimate behaviour in
a pit (fog pools in low, sheltered curves before it reaches open
benches).
"""
from __future__ import annotations


class FogController:
    def __init__(self, cfg: dict):
        self.levels: dict[str, float] = cfg["levels"]
        self.deterioration_rate = cfg["deterioration_rate_m_per_min"]
        self.minimum_visibility = cfg["minimum_visibility_m"]
        self.zone_multipliers: dict[str, float] = cfg["zone_multipliers"]

        self._ordered = sorted(self.levels.items(), key=lambda kv: -kv[1])

        self.auto_mode = False
        self.visibility_m: float = self.levels["CLEAR"]
        self.elapsed_minutes = 0.0

    def set_level(self, level: str):
        level = level.upper()
        if level not in self.levels:
            raise ValueError(f"Unknown fog level: {level}")
        self.auto_mode = False
        self.visibility_m = self.levels[level]
        self.elapsed_minutes = 0.0

    def set_auto(self, enabled: bool):
        self.auto_mode = enabled
        if enabled:
            self.elapsed_minutes = 0.0

    def status_for_visibility(self, visibility_m: float) -> str:
        for label, threshold in self._ordered:
            if visibility_m >= threshold:
                return label
        return self._ordered[-1][0]

    def update(self, dt_seconds: float):
        if not self.auto_mode:
            return
        self.elapsed_minutes += dt_seconds / 60.0
        lost = self.deterioration_rate * self.elapsed_minutes
        start = self.levels["CLEAR"]
        self.visibility_m = max(self.minimum_visibility, start - lost)

    def visibility_at(self, zone_type: str) -> float:
        mult = self.zone_multipliers.get(zone_type, 1.0)
        return max(self.minimum_visibility, self.visibility_m * mult)

    def state(self) -> dict:
        zones = {
            zt: {"visibility_m": round(self.visibility_at(zt), 1), "status": self.status_for_visibility(self.visibility_at(zt))}
            for zt in self.zone_multipliers
        }
        return {
            "visibility_m": round(self.visibility_m, 1),
            "status": self.status_for_visibility(self.visibility_m),
            "auto_mode": self.auto_mode,
            "elapsed_minutes": round(self.elapsed_minutes, 1),
            "zones": zones,
        }

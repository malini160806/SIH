"""
Fog controller.

Two modes:
  * Manual  - operator picks a level (CLEAR/LIGHT/MEDIUM/HEAVY/EXTREME)
              and visibility snaps to the configured value for that level.
  * Auto    - visibility deteriorates over time at a configurable rate
              (metres lost per minute), used by DEMO MODE and for a more
              "alive" feeling simulation.

`status_for_visibility()` maps a visibility distance back to a label so
the two modes always agree on how a given visibility is described.
"""
from __future__ import annotations


class FogController:
    def __init__(self, cfg: dict):
        self.levels: dict[str, float] = cfg["levels"]  # e.g. {"CLEAR": 200, ...}
        self.deterioration_rate = cfg["deterioration_rate_m_per_min"]
        self.minimum_visibility = cfg["minimum_visibility_m"]

        # order from best to worst so status_for_visibility can walk down
        self._ordered = sorted(self.levels.items(), key=lambda kv: -kv[1])
        # Initialize visibility state
        self.auto_mode = False
        self.visibility_m: float = self.levels["CLEAR"]
        self.elapsed_minutes = 0.0

    def get_current_visibility(self) -> float:
        """Return the current visibility distance in meters.

        This helper provides a simple accessor for external callers that need
        only the numeric visibility value without the additional status
        information.
        """
        return self.visibility_m



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
        return self._ordered[-1][0]  # worst label (EXTREME)

    def update(self, dt_seconds: float):
        if not self.auto_mode:
            return
        self.elapsed_minutes += dt_seconds / 60.0
        lost = self.deterioration_rate * self.elapsed_minutes
        start = self.levels["CLEAR"]
        self.visibility_m = max(self.minimum_visibility, start - lost)

    def state(self) -> dict:
        return {
            "visibility_m": round(self.visibility_m, 1),
            "status": self.status_for_visibility(self.visibility_m),
            "auto_mode": self.auto_mode,
            "elapsed_minutes": round(self.elapsed_minutes, 1),
        }

"""
Collision-risk engine.

TTC = Distance / Relative Closing Speed

Warning levels (thresholds come from config.yaml, not hard-coded):
    RED    - TTC <= ttc_red_s                      (critical, brake/stop)
    ORANGE - TTC <= ttc_orange_s                    (high risk)
    YELLOW - TTC <= ttc_yellow_s, or very close but not closing (caution)
    GREEN  - everything else (safe)
"""
from __future__ import annotations

from .models import RiskAssessment


class RiskEngine:
    def __init__(self, cfg: dict):
        self.ttc_red = cfg["ttc_red_s"]
        self.ttc_orange = cfg["ttc_orange_s"]
        self.ttc_yellow = cfg["ttc_yellow_s"]
        self.caution_distance = cfg["caution_distance_m"]
        self.critical_distance = cfg["critical_distance_m"]

    def assess(self, gap_m: float | None, closing_speed_mps: float, ahead_id: str | None) -> RiskAssessment:
        if gap_m is None:
            return RiskAssessment(level="GREEN", ttc_s=None, gap_m=None, ahead_id=None)

        ttc = gap_m / closing_speed_mps if closing_speed_mps > 0.05 else None

        if gap_m <= self.critical_distance:
            level = "RED"
        elif ttc is not None and ttc <= self.ttc_red:
            level = "RED"
        elif ttc is not None and ttc <= self.ttc_orange:
            level = "ORANGE"
        elif (ttc is not None and ttc <= self.ttc_yellow) or gap_m <= self.caution_distance:
            level = "YELLOW"
        else:
            level = "GREEN"

        return RiskAssessment(
            level=level,
            ttc_s=round(ttc, 1) if ttc is not None else None,
            gap_m=round(gap_m, 1),
            ahead_id=ahead_id,
        )

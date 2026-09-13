"""
DEMO MODE — a scripted walkthrough that demonstrates all three FOGNET
novelties end-to-end for judges, without requiring anyone to manually
drive fog levels or vehicle positions live.

It only ever nudges fog level and repositions two or three trucks at
specific moments (exactly like a director blocking a scene) — every
other module (sensors, fusion, risk engine, speed advisor, V2X,
dead reckoning) keeps running exactly as it does outside demo mode.
"""
from __future__ import annotations

import time


class _Step:
    def __init__(self, start_s: float, title: str, description: str, on_enter=None):
        self.start_s = start_s
        self.title = title
        self.description = description
        self.on_enter = on_enter or (lambda engine: None)


def _phase2_blind_curve(engine):
    road = engine.road
    d1 = engine.manager.vehicles["DUMPER-01"]
    d2 = engine.manager.vehicles["DUMPER-02"]
    # DUMPER-01 descending (empty return) toward the curve from one side,
    # DUMPER-02 ascending (loaded haul) toward it from the other side —
    # ~150 m apart at this radius, close enough to converge into radar
    # range (90 m) within the phase window. Terrain blocks their direct
    # line of sight, but V2X/radar/thermal will pick each other up.
    d1.theta = road.blind_curve_center - 0.38
    d1.phase = "EMPTY_RETURN"
    d2.theta = road.blind_curve_center + 0.38
    d2.phase = "LOADED_HAUL"
    # sync x/y/etc immediately so this tick's sensors see consistent coordinates
    engine.manager.place(d1)
    engine.manager.place(d2)


def _phase5_gps_denied(engine):
    d3 = engine.manager.vehicles["DUMPER-03"]
    lo, hi = engine.road.gps_denied_window
    d3.theta = lo + 0.03
    d3.phase = "EMPTY_RETURN"
    engine.manager.place(d3)
    # the teleport above is a demo-only staging move, not real motion —
    # resync dead reckoning to the new true position so the "signal
    # lost" moment doesn't compute a huge bogus one-tick drift
    engine.dead_reckoning.reset("DUMPER-03", d3.x, d3.y)


def _phase6_gps_restored(engine):
    d3 = engine.manager.vehicles["DUMPER-03"]
    lo, hi = engine.road.gps_denied_window
    d3.theta = hi + 0.35  # advance it clear of the denied window
    engine.manager.place(d3)


STEPS = [
    _Step(0, "PHASE 1 — NORMAL OPERATION",
          "Fleet hauling normally across the spiral: some trucks ascending loaded, "
          "some descending empty, some loading or dumping.",
          lambda e: e.fog.set_level("CLEAR")),
    _Step(8, "PHASE 2 — BLIND CURVE",
          "DUMPER-01 and DUMPER-02 approach the blind curve from opposite directions. "
          "The rock wall blocks their direct line of sight.",
          _phase2_blind_curve),
    _Step(18, "PHASE 3 — DYNAMIC SPEED",
          "Both trucks smoothly decelerate as the curvature-based speed advisor "
          "reduces the recommended speed approaching the sharp bend.",
          lambda e: e.fog.set_level("LIGHT")),
    _Step(30, "PHASE 4 — MULTI-TIER V2X",
          "V2V confirms the oncoming truck, V2I relays local road status from the "
          "blind-curve node, and V2C reports the situation to the control centre.",
          None),
    _Step(38, "PHASE 5 — GPS-DENIED ZONE",
          "DUMPER-03 enters a deep-bench rock-wall shadow. RTK-GNSS signal is lost.",
          _phase5_gps_denied),
    _Step(48, "PHASE 6 — GPS RESTORED",
          "DUMPER-03 clears the shadow zone. RTK-GNSS re-acquires and the position "
          "estimate re-synchronizes.",
          _phase6_gps_restored),
]
TOTAL_DURATION_S = 58


class DemoController:
    def __init__(self):
        self.active = False
        self.start_time = 0.0
        self.current_step = -1

    def start(self, engine):
        self.active = True
        self.start_time = time.time()
        self.current_step = -1

    def stop(self, engine=None):
        self.active = False
        self.current_step = -1
        if engine is not None:
            engine.fog.set_level("CLEAR")

    def apply(self, engine):
        if not self.active:
            return
        elapsed = time.time() - self.start_time

        if elapsed >= TOTAL_DURATION_S:
            self.stop(engine)
            return

        step_index = 0
        for i, step in enumerate(STEPS):
            if elapsed >= step.start_s:
                step_index = i
        if step_index != self.current_step:
            self.current_step = step_index
            STEPS[step_index].on_enter(engine)

    def state(self) -> dict:
        if not self.active or self.current_step < 0:
            return {"active": self.active, "step_title": None, "step_description": None}
        step = STEPS[self.current_step]
        elapsed = time.time() - self.start_time
        return {
            "active": True,
            "step_index": self.current_step + 1,
            "step_count": len(STEPS),
            "step_title": step.title,
            "step_description": step.description,
            "elapsed_s": round(elapsed, 1),
            "total_s": TOTAL_DURATION_S,
        }

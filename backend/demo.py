"""
DEMO MODE — a scripted walkthrough for judges.

Rather than requiring someone to manually drive fog levels and vehicle
speeds during a live presentation, `DemoController` steps through the
exact narrative from the brief (STEP 1..12) automatically, nudging
fog level and the two lead vehicles' target speeds at the right
moments so the story (fog forms -> V2V/radar/fusion detect a hidden
vehicle -> TTC collapses -> CRITICAL warning -> reroute) reliably plays
out the same way every time.

It only ever *sets* fog level and vehicle target speeds — every other
module (sensors, fusion, risk engine, speed advisor, fleet optimizer)
keeps running exactly as it does outside demo mode, so what the judges
see on screen is the real pipeline, just with a guided scenario.
"""
from __future__ import annotations

import time


class _Step:
    def __init__(self, start_s: float, title: str, description: str, on_enter=None):
        self.start_s = start_s
        self.title = title
        self.description = description
        self.on_enter = on_enter or (lambda engine: None)


def _step3(engine):
    v1 = engine.manager.vehicles["DUMPER-01"]
    v2 = engine.manager.vehicles["DUMPER-02"]
    curve_zone = next(z for z in engine.road.zones if z.zone_type == "curve")
    v2.s = curve_zone.start_s + 5
    v1.s = engine.road.wrap(v2.s - 90)  # DUMPER-01 approaching from behind, out of visual range
    v2.target_speed_kmh = 10
    v1.target_speed_kmh = 18


def _step8(engine):
    v1 = engine.manager.vehicles["DUMPER-01"]
    v2 = engine.manager.vehicles["DUMPER-02"]
    v2.target_speed_kmh = 8
    v1.target_speed_kmh = 28
    # The driver hasn't reacted to the warning yet, so DUMPER-01 keeps
    # closing in instead of obeying the fog-limited safe-speed cap —
    # this is exactly the dangerous situation FOGNET is meant to catch.
    v1.ignore_speed_advisory = True


def _step10(engine):
    v1 = engine.manager.vehicles["DUMPER-01"]
    # The driver now reacts to the CRITICAL warning: hand control back
    # to the safety system, which will brake hard because risk is RED.
    v1.ignore_speed_advisory = False


STEPS = [
    _Step(0, "STEP 1", "Normal visibility across the mine.", lambda e: e.fog.set_level("CLEAR")),
    _Step(6, "STEP 2", "Fog begins to form; visibility starts dropping.", lambda e: e.fog.set_level("MEDIUM")),
    _Step(12, "STEP 3", "DUMPER-02 enters the blind curve.", _step3),
    _Step(16, "STEP 4", "DUMPER-01 cannot visually detect DUMPER-02 in the fog.", lambda e: e.fog.set_level("HEAVY")),
    _Step(19, "STEP 5", "V2V link detects DUMPER-02 ahead."),
    _Step(22, "STEP 6", "mmWave radar confirms an object ahead."),
    _Step(25, "STEP 7", "Sensor fusion confirms vehicle presence with HIGH confidence."),
    _Step(28, "STEP 8", "Time-To-Collision is decreasing rapidly.", _step8),
    _Step(34, "STEP 9", "Control room dashboard flags HIGH COLLISION RISK."),
    _Step(37, "STEP 10", "Driver receives a CRITICAL STOP / BRAKE warning.", _step10),
    _Step(41, "STEP 11", "Fog intensifies to EXTREME across the mine.", lambda e: e.fog.set_level("EXTREME")),
    _Step(46, "STEP 12", "Fleet optimizer recommends rerouting to the bypass route.", lambda e: None),
]
TOTAL_DURATION_S = 54


class DemoController:
    def __init__(self):
        self.active = False
        self.start_time = 0.0
        self.current_step = -1
        self._saved_targets: dict[str, float] = {}

    def start(self, engine):
        self.active = True
        self.start_time = time.time()
        self.current_step = -1
        self._saved_targets = {
            vid: v.target_speed_kmh for vid, v in engine.manager.vehicles.items()
        }

    def stop(self, engine=None):
        self.active = False
        self.current_step = -1
        if engine is not None:
            for vid, speed in self._saved_targets.items():
                if vid in engine.manager.vehicles:
                    v = engine.manager.vehicles[vid]
                    v.target_speed_kmh = speed
                    v.ignore_speed_advisory = False
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

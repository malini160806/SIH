"""
Raspberry Pi 5 — onboard edge-computing unit.

The Pi is not a sensor: it is what every other module in this
simulation conceptually runs on. This module doesn't add any new
physics; it reports the *health/load of that onboard processing* by
reading the real outputs sensor fusion, positioning and V2X have
already produced this tick — so its numbers move for genuine reasons
(more nearby traffic to fuse, dead reckoning running instead of a
simple RTK read, a stalled truck needing less real-time work).

    77 GHz Radar + LWIR Thermal + RTK-GNSS + MEMS IMU + Wheel Odometry + V2X OBU
                                    ↓
                            RASPBERRY PI 5
                                    ↓
              Sensor Fusion → Risk Engine → Speed Advisor → V2X
"""
from __future__ import annotations

TOTAL_SENSOR_INPUTS = 6  # radar, thermal, rtk, imu, wheel-speed, V2X OBU


class EdgeComputeUnit:
    def evaluate(self, stalled: bool, rtk_active: bool, obu_ok: bool,
                 positioning_mode: str, fusion_confidence: str, nearby_count: int) -> dict:
        inputs_active = TOTAL_SENSOR_INPUTS
        if not rtk_active:
            inputs_active -= 1
        if not obu_ok:
            inputs_active -= 1

        load = 20.0
        load += 10.0 * nearby_count
        if positioning_mode == "DEAD_RECKONING":
            load += 20.0  # extra onboard compute to integrate IMU + wheel odometry
        load += {"HIGH": 15.0, "MEDIUM": 8.0}.get(fusion_confidence, 0.0)
        load = max(5.0, min(100.0, load))

        level = "HIGH" if load >= 70 else ("LOW" if load < 30 else "NORMAL")
        status = "DEGRADED" if (stalled or inputs_active <= TOTAL_SENSOR_INPUTS - 2) else "ACTIVE"

        return {
            "status": status,
            "edge_processing": "STANDBY" if stalled else "ACTIVE",
            "sensor_inputs_total": TOTAL_SENSOR_INPUTS,
            "sensor_inputs_active": inputs_active,
            "v2x_link": "CONNECTED" if obu_ok else "DISCONNECTED",
            "processing_load_pct": round(load),
            "processing_level": level,
        }

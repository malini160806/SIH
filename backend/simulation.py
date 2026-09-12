"""
Simulation engine — the orchestrator that ties every module together
once per tick, matching the layered architecture:

    Vehicle Manager -> Sensor Fusion -> Risk Engine -> Fog -> Fleet Optimization

Each tick it:
  1. advances fog state
  2. computes forward gaps between vehicles
  3. reads simulated sensors (radar/thermal/gps/imu) for each vehicle
  4. broadcasts V2V messages
  5. fuses sensor + V2V evidence into a detection result
  6. assesses collision risk (TTC) and recommended safe speed
  7. moves vehicles according to that recommended speed
  8. runs emergency detection
  9. runs fleet optimization
  10. logs to SQLite (throttled) and returns one JSON-able state dict
      for the WebSocket broadcast
"""
from __future__ import annotations

import time

from . import db
from .config import load_config
from .emergency import EmergencyDetector
from .fleet_optimizer import FleetOptimizer
from .fog import FogController
from .fusion import fuse
from .models import RadarReading, ThermalReading
from .risk_engine import RiskEngine
from .road_network import RoadNetwork
from .sensors import MMWaveRadarSim, ThermalCameraSim, RTKGPSSim, IMUSim
from .speed_advisor import SpeedAdvisor
from .v2v import V2VNetwork
from .vehicle import VehicleManager


class SimulationEngine:
    def __init__(self):
        self.cfg = load_config()
        self.road = RoadNetwork()
        self.manager = VehicleManager(
            self.road,
            self.cfg["vehicles"]["ids"],
            self.cfg["vehicles"]["default_target_speed_kmh"],
        )
        self.fog = FogController(self.cfg["fog"])
        self.risk_engine = RiskEngine(self.cfg["risk"])
        self.speed_advisor = SpeedAdvisor(self.cfg["speed_advisor"])
        self.fleet_optimizer = FleetOptimizer(self.cfg["fleet"])
        self.emergency_detector = EmergencyDetector(self.cfg["emergency"])
        self.v2v = V2VNetwork(self.road, self.cfg["vehicles"]["comm_range_m"])

        s_cfg = self.cfg["sensors"]
        self.radar = MMWaveRadarSim(s_cfg["radar_range_m"], s_cfg["radar_noise_m"], s_cfg["radar_speed_noise_mps"])
        self.thermal = ThermalCameraSim(s_cfg["thermal_range_m"], s_cfg["thermal_base_confidence"])
        self.gps = RTKGPSSim(s_cfg["gps_noise_m"])
        self.imu = IMUSim(s_cfg["imu_noise"])

        self.dt = self.cfg["simulation"]["tick_seconds"]
        self.max_accel = self.cfg["vehicles"]["max_accel_mps2"]
        self.max_decel = self.cfg["vehicles"]["max_decel_mps2"]
        self.log_every = self.cfg["simulation"]["telemetry_log_every"]

        self.tick_count = 0
        self.recent_events: list[dict] = []
        self.demo = None  # set by demo.py to avoid a circular import

        db.init_db()

    # ------------------------------------------------------------------
    def tick(self) -> dict:
        dt = self.dt
        self.tick_count += 1

        if self.demo is not None:
            self.demo.apply(self)

        self.fog.update(dt)
        fog_state = self.fog.state()
        visibility_m = fog_state["visibility_m"]

        messages = self.v2v.broadcast(self.manager)

        gaps: dict[str, tuple[str | None, float | None]] = {}
        closing_speeds: dict[str, float] = {}
        for vid, v in self.manager.vehicles.items():
            ahead_id, gap = self.manager.gap_ahead(vid)
            gaps[vid] = (ahead_id, gap)
            if ahead_id is not None and gap is not None:
                ahead_speed_mps = self.manager.vehicles[ahead_id].speed_kmh / 3.6
                self_speed_mps = v.speed_kmh / 3.6
                closing_speeds[vid] = max(0.0, self_speed_mps - ahead_speed_mps)
            else:
                closing_speeds[vid] = 0.0

        sensor_readings: dict[str, dict] = {}
        fusion_results: dict[str, dict] = {}
        risks: dict[str, object] = {}
        recommended_speeds: dict[str, float] = {}
        nearby_counts: dict[str, int] = {}

        for vid, v in self.manager.vehicles.items():
            ahead_id, gap = gaps[vid]
            context = {
                "gap_m": gap,
                "closing_speed_mps": closing_speeds[vid],
                "visibility_m": visibility_m,
                "x": v.x,
                "y": v.y,
                "vehicle_id": vid,
                "heading_deg": v.heading_deg,
                "accel_mps2": v.accel_mps2,
                "dt": dt,
            }
            radar_reading = RadarReading(**self.radar.read(context))
            thermal_reading = ThermalReading(**self.thermal.read(context))
            gps_reading = self.gps.read(context)
            imu_reading = self.imu.read(context)
            sensor_readings[vid] = {
                "radar": radar_reading.to_dict(),
                "thermal": thermal_reading.to_dict(),
                "gps": gps_reading,
                "imu": imu_reading,
            }

            v2v_msg = self.v2v.message_from_to(ahead_id, vid) if ahead_id else None
            fusion = fuse(radar_reading.to_dict(), thermal_reading.to_dict(), v2v_msg, ahead_id, gap)
            fusion_results[vid] = fusion.to_dict()

            risk = self.risk_engine.assess(gap, closing_speeds[vid], ahead_id)
            risks[vid] = risk
            v.hazard_status = risk.level

            nearby = sum(
                1
                for other_id, other_gap in gaps.values()
                if other_gap is not None and other_gap <= 80
            )
            nearby_counts[vid] = nearby

            recommended_speeds[vid] = self.speed_advisor.recommend(
                visibility_m, v.speed_kmh, v.zone_type, risk, nearby
            )

        self.manager.step(dt, recommended_speeds, self.max_accel, self.max_decel)

        new_events = []
        for vid, v in self.manager.vehicles.items():
            ahead_id, gap = gaps[vid]
            events = self.emergency_detector.check(v, dt, gap, closing_speeds[vid], v.zone_name)
            for e in events:
                edict = e.to_dict()
                new_events.append(edict)
                db.log_event(edict)
        if new_events:
            self.recent_events = (new_events + self.recent_events)[:30]

        fleet = self.fleet_optimizer.evaluate(fog_state["status"], self.manager.vehicles, risks)

        if self.tick_count % self.log_every == 0:
            db.log_telemetry(
                [
                    {
                        "timestamp": time.time(),
                        "vehicle_id": vid,
                        "x": v.x,
                        "y": v.y,
                        "speed_kmh": v.speed_kmh,
                        "heading_deg": v.heading_deg,
                        "hazard_status": v.hazard_status,
                        "visibility_m": visibility_m,
                    }
                    for vid, v in self.manager.vehicles.items()
                ]
            )

        return {
            "timestamp": time.time(),
            "tick": self.tick_count,
            "road": self.road.to_geojson_like(),
            "fog": fog_state,
            "vehicles": {vid: v.to_dict() for vid, v in self.manager.vehicles.items()},
            "gaps": {vid: {"ahead_id": a, "gap_m": round(g, 1) if g is not None else None} for vid, (a, g) in gaps.items()},
            "sensors": sensor_readings,
            "fusion": fusion_results,
            "risk": {vid: r.to_dict() for vid, r in risks.items()},
            "recommended_speed": recommended_speeds,
            "v2v_messages": [m.to_dict() for m in messages],
            "fleet": fleet,
            "emergency_events": self.recent_events,
            "demo": self.demo.state() if self.demo is not None else {"active": False},
        }

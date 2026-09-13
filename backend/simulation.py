"""
Simulation engine — the orchestrator that ties every module together
once per tick:

    Vehicle Manager -> Sensors -> Positioning (RTK / Dead Reckoning)
    -> Sensor Fusion -> Risk Engine -> Speed Advisor -> V2X (V2V/V2I/V2C)

Each tick it:
  1. advances fog state
  2. for every vehicle: finds the nearest other vehicle (by along-road
     distance) and whether the gap is closing
  3. reads simulated sensors (radar/thermal/RTK/IMU/wheel-speed)
  4. resolves the absolute-position estimate (RTK, or dead reckoning
     when RTK is lost)
  5. broadcasts V2V messages, evaluates V2I connectivity, aggregates V2C
  6. fuses radar+thermal+V2V into a detection result
  7. assesses collision risk (TTC) and the curvature-based recommended
     speed
  8. moves every vehicle along the spiral according to that speed
  9. runs emergency detection
  10. logs to SQLite (throttled) and returns one JSON-able state dict
      for the WebSocket broadcast
"""
from __future__ import annotations

import time

from . import db
from .config import load_config
from .dead_reckoning import DeadReckoning
from .edge_compute import EdgeComputeUnit
from .emergency import EmergencyDetector
from .fog import FogController
from .fusion import fuse
from .models import RadarReading, RiskAssessment, ThermalReading
from .obu import V2XOnBoardUnit
from .risk_engine import RiskEngine
from .road_network import RoadNetwork
from .sensors import MMWaveRadarSim, ThermalCameraSim, RTKGnssSim, IMUSim, WheelSpeedSim
from .speed_advisor import SpeedAdvisor
from .v2c import V2CControlCentre
from .v2i import V2INetwork
from .v2v import V2VNetwork
from .vehicle import VehicleManager


class SimulationEngine:
    def __init__(self):
        self.cfg = load_config()
        self._build_world()

        self.dt = self.cfg["simulation"]["tick_seconds"]
        self.max_accel = self.cfg["vehicles"]["max_accel_mps2"]
        self.max_decel = self.cfg["vehicles"]["max_decel_mps2"]
        self.log_every = self.cfg["simulation"]["telemetry_log_every"]

        self.tick_count = 0
        self.recent_events: list[dict] = []
        self.demo = None  # set by main.py to avoid a circular import

        self.paused = False
        self.sim_speed = 1.0
        self.gps_force_denied = False
        self.v2x_enabled = True

        db.init_db()

    def _build_world(self):
        self.road = RoadNetwork(self.cfg)
        self.manager = VehicleManager(self.road, self.cfg["vehicles"]["ids"], self.cfg["haul_cycle"])
        self.fog = FogController(self.cfg["fog"])
        self.risk_engine = RiskEngine(self.cfg["risk"])
        self.speed_advisor = SpeedAdvisor(self.cfg["speed_advisor"])
        self.emergency_detector = EmergencyDetector(self.cfg["emergency"])
        self.v2v = V2VNetwork(self.road, self.cfg["vehicles"]["comm_range_m"])
        self.v2i = V2INetwork(self.road, self.cfg["vehicles"]["v2i_range_m"])
        self.v2c = V2CControlCentre()
        self.dead_reckoning = DeadReckoning()
        self.obu = V2XOnBoardUnit()
        self.edge_compute = EdgeComputeUnit()

        s_cfg = self.cfg["sensors"]
        self.radar = MMWaveRadarSim(s_cfg["radar_range_m"], s_cfg["radar_noise_m"], s_cfg["radar_speed_noise_mps"])
        self.thermal = ThermalCameraSim(s_cfg["thermal_range_m"], s_cfg["thermal_base_confidence"])
        self.rtk = RTKGnssSim(s_cfg["rtk_noise_m"])
        self.imu = IMUSim(s_cfg["imu_noise"], s_cfg.get("imu_tilt_warning_threshold", 0.75))
        self.wheel = WheelSpeedSim(s_cfg["wheel_speed_noise_kmh"])

    def reset(self):
        self._build_world()
        self.tick_count = 0
        self.recent_events = []
        self.paused = False
        if self.demo is not None:
            self.demo.stop(self)

    # ------------------------------------------------------------------
    def tick(self) -> dict:
        dt = self.dt * self.sim_speed if not self.paused else 0.0
        self.tick_count += 1

        if self.demo is not None:
            self.demo.apply(self)

        self.fog.update(dt)
        fog_state = self.fog.state()

        messages = self.v2v.broadcast(self.manager, self.v2x_enabled)

        nearest: dict[str, tuple[str | None, float | None]] = {}
        closing: dict[str, float] = {}
        for vid in self.manager.vehicles:
            other_id, gap = self.manager.gap_to_nearest(vid)
            nearest[vid] = (other_id, gap)
            closing[vid] = self.manager.closing_speed(vid, other_id) if other_id else 0.0

        sensor_readings: dict[str, dict] = {}
        fusion_results: dict[str, dict] = {}
        risks: dict[str, object] = {}
        positioning: dict[str, dict] = {}
        recommended_speeds: dict[str, float] = {}
        nearby_counts: dict[str, int] = {}

        for vid, v in self.manager.vehicles.items():
            other_id, gap = nearest[vid]
            other = self.manager.vehicles.get(other_id) if other_id else None
            local_visibility = self.fog.visibility_at(v.zone_type)

            context = {
                "gap_m": gap,
                "closing_speed_mps": closing[vid],
                "visibility_m": local_visibility,
                "self_x": v.x, "self_y": v.y, "self_heading_deg": v.heading_deg,
                "other_x": other.x if other else None, "other_y": other.y if other else None,
                "x": v.x, "y": v.y,
                "vehicle_id": vid,
                "heading_deg": v.heading_deg, "accel_mps2": v.accel_mps2,
                "speed_kmh": v.speed_kmh, "odometry_m": v.odometry_m,
                "stalled": v.stalled, "lateral_offset": v.lateral_offset,
                "travel_direction": v.travel_direction_label,
                "dt": dt,
                "denied": self.gps_force_denied or self.road.is_gps_denied(v.theta),
            }
            radar_reading = RadarReading(**self.radar.read(context))
            thermal_reading = ThermalReading(**self.thermal.read(context))
            rtk_reading = self.rtk.read(context)
            imu_reading = self.imu.read(context)
            wheel_reading = self.wheel.read(context)

            position_estimate = self.dead_reckoning.update(
                vid, rtk_reading, imu_reading, wheel_reading, dt, v.x, v.y
            )
            positioning[vid] = {**position_estimate.to_dict(), "rtk_status": rtk_reading["status"]}

            sensor_readings[vid] = {
                "radar": radar_reading.to_dict(),
                "thermal": thermal_reading.to_dict(),
                "rtk": rtk_reading,
                "imu": imu_reading,
                "wheel_speed": wheel_reading,
            }

            v2v_msg = self.v2v.message_from_to(other_id, vid) if other_id else None
            fusion = fuse(radar_reading.to_dict(), thermal_reading.to_dict(), v2v_msg, other_id, gap)
            fusion_results[vid] = fusion.to_dict()

            if v.phase in ("LOADING", "DUMPING"):
                # a truck parked at the loading/dumping point is stationary by
                # design (queueing), not "approaching" anything — don't let a
                # tight queueing gap falsely trigger a permanent collision alert
                risk = RiskAssessment(
                    level="GREEN", ttc_s=None,
                    gap_m=round(gap, 1) if gap is not None else None,
                    other_id=other_id, relation="QUEUEING",
                )
            else:
                relation = "APPROACHING" if closing[vid] > 0.05 else "STABLE"
                risk = self.risk_engine.assess(gap, closing[vid], other_id, relation)
            risks[vid] = risk
            v.hazard_status = risk.level

            nearby = sum(1 for _, g in nearest.values() if g is not None and g <= 80)
            nearby_counts[vid] = nearby

            curvature_radius = self.road.curvature_radius_at(v.theta)
            recommended_speeds[vid] = self.speed_advisor.recommend(
                curvature_radius, v.zone_type, v.loaded, local_visibility, risk, nearby, v.speed_factor
            )

        self.manager.step(dt, recommended_speeds, self.max_accel, self.max_decel)

        new_events = []
        for vid, v in self.manager.vehicles.items():
            _, gap = nearest[vid]
            events = self.emergency_detector.check(v, dt, gap, closing[vid], v.zone_name)
            for e in events:
                edict = e.to_dict()
                new_events.append(edict)
                db.log_event(edict)
        if new_events:
            self.recent_events = (new_events + self.recent_events)[:30]

        v2i_status = self.v2i.evaluate(self.manager, self.fog, self.v2x_enabled, risks)
        v2c_status = self.v2c.evaluate(self.manager, self.v2x_enabled, positioning, v2i_status)
        v2c_connected_by_id = {row["id"]: row["v2x_status"] == "CONNECTED" for row in v2c_status["vehicles"]}

        obu_status: dict[str, dict] = {}
        edge_status: dict[str, dict] = {}
        for vid, v in self.manager.vehicles.items():
            obu_ok = self.v2x_enabled and v.comm_ok
            obu_status[vid] = self.obu.build(
                vid, self.v2x_enabled, v.comm_ok, messages, v2i_status.get(vid), v2c_connected_by_id.get(vid, False)
            )
            edge_status[vid] = self.edge_compute.evaluate(
                v.stalled,
                sensor_readings[vid]["rtk"]["status"] == "ACTIVE",
                obu_ok,
                positioning[vid]["mode"],
                fusion_results[vid]["confidence"],
                nearby_counts[vid],
            )

        if self.tick_count % self.log_every == 0:
            db.log_telemetry([
                {
                    "timestamp": time.time(), "vehicle_id": vid, "x": v.x, "y": v.y,
                    "speed_kmh": v.speed_kmh, "heading_deg": v.heading_deg,
                    "hazard_status": v.hazard_status, "visibility_m": self.fog.visibility_at(v.zone_type),
                }
                for vid, v in self.manager.vehicles.items()
            ])

        return {
            "timestamp": time.time(),
            "tick": self.tick_count,
            "paused": self.paused,
            "sim_speed": self.sim_speed,
            "gps_force_denied": self.gps_force_denied,
            "v2x_enabled": self.v2x_enabled,
            "fog": fog_state,
            "vehicles": {vid: v.to_dict() for vid, v in self.manager.vehicles.items()},
            "nearest": {vid: {"other_id": o, "gap_m": round(g, 1) if g is not None else None} for vid, (o, g) in nearest.items()},
            "sensors": sensor_readings,
            "positioning": positioning,
            "fusion": fusion_results,
            "risk": {vid: r.to_dict() for vid, r in risks.items()},
            "recommended_speed": recommended_speeds,
            "v2v_messages": [m.to_dict() for m in messages],
            "v2i": v2i_status,
            "v2c": v2c_status,
            "obu": obu_status,
            "edge_compute": edge_status,
            "emergency_events": self.recent_events,
            "demo": self.demo.state() if self.demo is not None else {"active": False},
        }

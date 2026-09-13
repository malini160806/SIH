"""
Shared plain-data structures passed between FOGNET modules.

Each dataclass mirrors exactly one physical sensor's actual output —
see sensors/*.py — so it's impossible to accidentally attribute a
piece of information (e.g. distance) to the wrong sensor (e.g. thermal)
anywhere downstream.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field, asdict
from typing import Optional


def now() -> float:
    return time.time()


@dataclass
class RadarReading:
    """77 GHz mmWave radar: object detection + RANGE only."""
    detected: bool
    distance_m: Optional[float] = None
    relative_speed_mps: Optional[float] = None

    def to_dict(self):
        return asdict(self)


@dataclass
class ThermalReading:
    """LWIR thermal array: heat detection + centroid ANGLE only (no distance)."""
    detected: bool
    confidence: float = 0.0
    centroid_angle_deg: Optional[float] = None
    direction: Optional[str] = None

    def to_dict(self):
        return asdict(self)


@dataclass
class RTKReading:
    """RTK-GNSS: absolute position, or LOST when denied."""
    status: str  # ACTIVE | LOST
    x: Optional[float] = None
    y: Optional[float] = None
    accuracy_cm: Optional[float] = None

    def to_dict(self):
        return asdict(self)


@dataclass
class IMUReading:
    """MEMS IMU: heading, yaw rate, acceleration and orientation — every
    value is derived from the vehicle's actual simulated motion (heading
    change over time, real acceleration, real lateral drift), never
    generated independently of it."""
    status: str            # ACTIVE | WARNING
    heading_deg: float
    yaw_rate_deg_s: float
    acceleration_mps2: float
    orientation: str        # STABLE | TILT WARNING
    motion_state: str       # STATIONARY | ACCELERATING | DECELERATING | CRUISING

    def to_dict(self):
        return asdict(self)


@dataclass
class WheelSpeedReading:
    """Wheel-speed sensor: speed + cumulative odometry, always available
    regardless of GNSS status — this is one of the two inputs (with IMU
    heading) that keep position estimation alive when RTK is lost."""
    speed_kmh: float
    odometry_m: float
    travel_direction: str
    status: str = "ACTIVE"

    def to_dict(self):
        return asdict(self)


@dataclass
class PositionEstimate:
    """Fused absolute-position estimate: RTK when available, kinematic
    dead reckoning (IMU heading + wheel-speed odometry from the last
    known RTK fix) when it is not."""
    x: float
    y: float
    mode: str  # RTK | DEAD_RECKONING
    drift_m: float = 0.0
    distance_since_loss_m: float = 0.0

    def to_dict(self):
        return asdict(self)


@dataclass
class FusionResult:
    detected: bool
    confidence: str  # NONE | LOW | MEDIUM | HIGH
    contributing_sensors: list = field(default_factory=list)
    target_id: Optional[str] = None
    range_m: Optional[float] = None
    centroid_angle_deg: Optional[float] = None

    def to_dict(self):
        return asdict(self)


@dataclass
class RiskAssessment:
    level: str  # GREEN | YELLOW | ORANGE | RED
    ttc_s: Optional[float]
    gap_m: Optional[float]
    other_id: Optional[str]
    relation: Optional[str] = None  # APPROACHING | FOLLOWING | STABLE

    def to_dict(self):
        return asdict(self)


@dataclass
class V2VMessage:
    sender: str
    receiver: str
    text: str
    payload: dict
    timestamp: float = field(default_factory=now)

    def to_dict(self):
        return asdict(self)


@dataclass
class EmergencyEvent:
    type: str
    vehicle_id: str
    location: str
    status: str
    timestamp: float = field(default_factory=now)

    def to_dict(self):
        return asdict(self)

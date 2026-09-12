"""
Shared plain-data structures passed between FOGNET modules.

Everything here is a dataclass with a `to_dict()` so it can be dropped
straight into a JSON WebSocket frame without extra glue code.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field, asdict
from typing import Optional


def now() -> float:
    return time.time()


@dataclass
class RadarReading:
    detected: bool
    distance_m: Optional[float] = None
    relative_speed_mps: Optional[float] = None

    def to_dict(self):
        return asdict(self)


@dataclass
class ThermalReading:
    detected: bool
    confidence: float = 0.0

    def to_dict(self):
        return asdict(self)


@dataclass
class GPSReading:
    x: float
    y: float
    accuracy_cm: float

    def to_dict(self):
        return asdict(self)


@dataclass
class IMUReading:
    acceleration_mps2: float
    angular_velocity_dps: float
    heading_deg: float

    def to_dict(self):
        return asdict(self)


@dataclass
class FusionResult:
    detected: bool
    confidence: str  # NONE | LOW | MEDIUM | HIGH
    contributing_sensors: list = field(default_factory=list)
    target_id: Optional[str] = None
    distance_m: Optional[float] = None

    def to_dict(self):
        return asdict(self)


@dataclass
class RiskAssessment:
    level: str  # GREEN | YELLOW | ORANGE | RED
    ttc_s: Optional[float]
    gap_m: Optional[float]
    ahead_id: Optional[str]

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

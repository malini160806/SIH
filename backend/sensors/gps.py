"""RTK-GPS simulation — centimetre-accurate position, unaffected by fog."""
from __future__ import annotations

import random

from .base import SensorInterface
from ..models import GPSReading


class RTKGPSSim(SensorInterface):
    def __init__(self, noise_m: float):
        self.noise_m = noise_m

    def read(self, context: dict) -> dict:
        x = context["x"] + random.gauss(0, self.noise_m)
        y = context["y"] + random.gauss(0, self.noise_m)
        return GPSReading(x=round(x, 2), y=round(y, 2), accuracy_cm=round(self.noise_m * 100, 1)).to_dict()

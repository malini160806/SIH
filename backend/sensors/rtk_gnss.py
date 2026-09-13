"""RTK-GNSS simulation — centimetre-accurate absolute position, unless
the truck is inside a GPS-denied zone (deep bench / rock-wall shadow)
or the operator has forced denial for a demo, in which case it reports
SIGNAL LOST and no position at all."""
from __future__ import annotations

import random

from .base import SensorInterface
from ..models import RTKReading


class RTKGnssSim(SensorInterface):
    def __init__(self, noise_m: float):
        self.noise_m = noise_m

    def read(self, context: dict) -> dict:
        if context.get("denied"):
            return RTKReading(status="LOST").to_dict()
        x = context["x"] + random.gauss(0, self.noise_m)
        y = context["y"] + random.gauss(0, self.noise_m)
        return RTKReading(
            status="ACTIVE", x=round(x, 2), y=round(y, 2), accuracy_cm=round(self.noise_m * 100, 1)
        ).to_dict()

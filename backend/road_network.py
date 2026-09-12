"""
A miniature closed-loop mine-haul-road network.

Vehicles are represented by a single scalar "s" = arc-length travelled
along the loop (metres). This makes "distance to vehicle ahead" and
"who is ahead of whom" trivial to compute, while still letting us draw
a realistic-looking 2D road with a loading area, a straight, a blind
curve, an intersection and a dumping area.

Coordinates are in an arbitrary metre-scale plane; the frontend scales
them to fit the canvas.
"""
from __future__ import annotations

import bisect
import math
from dataclasses import dataclass

# Waypoints tracing one full loop of the haul road (closes back to index 0).
WAYPOINTS = [
    (120, 560),   # 0  loading area
    (120, 480),
    (120, 350),
    (120, 220),   # 3  approach to curve
    (150, 120),   # 4  blind curve
    (230, 60),    # 5  blind curve apex
    (340, 50),    # 6  curve exit
    (460, 70),
    (560, 130),   # 8  approach to intersection
    (620, 230),   # 9  intersection
    (650, 340),
    (700, 440),
    (760, 520),   # 12 dumping area
    (650, 570),
    (480, 590),
    (300, 580),
    (180, 570),
]

# Zone type assigned to the *segment starting* at each waypoint index.
SEGMENT_ZONES = {
    0: "loading",
    1: "straight",
    2: "straight",
    3: "curve",
    4: "curve",
    5: "curve",
    6: "straight",
    7: "straight",
    8: "intersection",
    9: "straight",
    10: "straight",
    11: "dumping",
    12: "straight",
    13: "straight",
    14: "straight",
    15: "straight",
    16: "straight",
}

# Segments (by starting waypoint index) that are considered inside the
# fog-prone "blind curve" area used by the fleet optimizer / demo mode.
FOG_ZONE_SEGMENTS = {3, 4, 5}

ZONE_LABELS = {
    "loading": "Loading Area",
    "dumping": "Dumping Area",
    "curve": "Blind Curve",
    "intersection": "Intersection",
    "straight": "Straight Road",
}


@dataclass
class Zone:
    name: str
    zone_type: str
    start_s: float
    end_s: float
    is_fog_zone: bool


class RoadNetwork:
    """Precomputes arc-length lookups over the closed waypoint loop."""

    def __init__(self):
        self.points = WAYPOINTS
        n = len(self.points)
        self._cumulative = [0.0]
        for i in range(n):
            a = self.points[i]
            b = self.points[(i + 1) % n]
            dist = math.hypot(b[0] - a[0], b[1] - a[1])
            self._cumulative.append(self._cumulative[-1] + dist)
        self.total_length = self._cumulative[-1]

        self.zones: list[Zone] = []
        for i in range(n):
            zone_type = SEGMENT_ZONES[i]
            self.zones.append(
                Zone(
                    name=ZONE_LABELS[zone_type],
                    zone_type=zone_type,
                    start_s=self._cumulative[i],
                    end_s=self._cumulative[i + 1],
                    is_fog_zone=i in FOG_ZONE_SEGMENTS,
                )
            )

    def wrap(self, s: float) -> float:
        return s % self.total_length

    def point_at_s(self, s: float) -> tuple[float, float]:
        s = self.wrap(s)
        idx = bisect.bisect_right(self._cumulative, s) - 1
        idx = max(0, min(idx, len(self.points) - 1))
        seg_start = self._cumulative[idx]
        seg_len = self._cumulative[idx + 1] - seg_start
        t = 0.0 if seg_len == 0 else (s - seg_start) / seg_len
        a = self.points[idx]
        b = self.points[(idx + 1) % len(self.points)]
        x = a[0] + (b[0] - a[0]) * t
        y = a[1] + (b[1] - a[1]) * t
        return x, y

    def heading_at_s(self, s: float) -> float:
        """Heading in degrees (0 = east, 90 = south, canvas-style y-down)."""
        s = self.wrap(s)
        idx = bisect.bisect_right(self._cumulative, s) - 1
        idx = max(0, min(idx, len(self.points) - 1))
        a = self.points[idx]
        b = self.points[(idx + 1) % len(self.points)]
        return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))

    def zone_at_s(self, s: float) -> Zone:
        s = self.wrap(s)
        for zone in self.zones:
            if zone.start_s <= s < zone.end_s:
                return zone
        return self.zones[-1]

    def gap_ahead(self, s_self: float, s_other: float) -> float:
        """Forward distance (m) from self to other, travelling with the loop."""
        return self.wrap(s_other - s_self)

    def to_geojson_like(self) -> dict:
        """Serialisable description of the road for the frontend digital twin."""
        return {
            "points": self.points,
            "total_length": self.total_length,
            "zones": [
                {
                    "name": z.name,
                    "type": z.zone_type,
                    "start_s": z.start_s,
                    "end_s": z.end_s,
                    "is_fog_zone": z.is_fog_zone,
                }
                for z in self.zones
            ],
        }

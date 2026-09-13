"""
Spiral open-pit haul-road network.

The road is a single continuous Archimedean spiral winding down from the
surface rim to the pit floor over several full turns. This is what
gives the digital twin genuine depth and multiple stepped benches,
instead of one flat loop:

    theta = 0            -> outer rim, surface, dumping area
    theta = theta_max     -> innermost point, pit floor, loading area

On top of the smooth spiral, a handful of "sharp bends" (config:
mine.sharp_bends) locally bulge or pull in the road radius, so certain
points genuinely have much tighter curvature than the gentle spiral
average — real switchbacks/hairpins, not just a hand-labelled zone.
Curvature (and therefore the recommended speed) is computed
numerically from the actual traced curve, so it responds correctly to
these bends automatically.

Every truck's position is a single scalar `theta` along this spiral.
Travelling with increasing theta descends toward the pit (EMPTY_RETURN,
going to load); travelling with decreasing theta ascends toward the
surface (LOADED_HAUL, hauling ore out).
"""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class Zone:
    zone_type: str   # bench_road | ramp | blind_curve | sharp_curve | intersection | loading | dumping
    name: str
    kind: str = ""   # bend shape, when zone_type is blind_curve/sharp_curve: blind | hairpin | tight_90 | s_curve | high_risk


@dataclass
class V2INode:
    node_id: str
    name: str
    zone_type: str
    theta: float
    x: float
    y: float


ZONE_LABELS = {
    "bench_road": "Bench Road",
    "ramp": "Ramp",
    "blind_curve": "Blind Curve",
    "sharp_curve": "Sharp Curve",
    "intersection": "Intersection",
    "loading": "Loading Area",
    "dumping": "Dumping Area",
}

_CURVE_ZONE_TYPES = ("blind_curve", "sharp_curve")


class RoadNetwork:
    def __init__(self, cfg: dict):
        m = cfg["mine"]
        self.cx = m["center_x"]
        self.cy = m["center_y"]
        self.r_outer = m["outer_radius_m"]
        self.r_inner = m["inner_radius_m"]
        self.turns = m["turns"]
        self.theta_max = self.turns * 2 * math.pi
        self.elev_surface = m["elevation_surface_m"]
        self.elev_pit = m["elevation_pit_m"]
        self.bench_names = m["bench_names"]

        self.dumping_window = tuple(m["dumping_window"])
        self.loading_window = (self.theta_max - m["loading_window_from_end"], self.theta_max)
        self.blind_curve_center = m["blind_curve_center"]
        self.blind_curve_half_width = m["blind_curve_half_width"]
        self.intersection_theta = m["intersection_theta"]
        self.ramp_node_theta = m["ramp_node_theta"]
        self.gps_denied_window = tuple(m["gps_denied_window"])

        # every bend here is a real geometric kink on the one haul road every
        # truck travels — see _bend_perturbation() and zone_at() below
        self.sharp_bends = m.get("sharp_bends", [])

        sa = cfg["speed_advisor"]
        self.ramp_half_width = sa.get("ramp_window_half_width", 0.15)
        self.intersection_half_width = sa.get("intersection_half_width", 0.12)

        self.v2i_nodes: list[V2INode] = self._build_v2i_nodes()
        self._compute_bend_min_curvature()

    def _compute_bend_min_curvature(self, samples: int = 41):
        """A raised-cosine radius bump, combined with the spiral's own
        curvature, briefly straightens out at one or two points inside an
        otherwise tight bend (a real geometric consequence of the shape,
        not a bug) — sampling curvature instantaneously there would make
        the recommended speed flicker up and back down mid-bend. Instead,
        precompute each bend's worst-case (tightest) curvature radius once
        and hold the speed advisor to that safe value across the whole
        bend — "maintain a safe reduced speed through the bend", exactly
        as a real curve-speed-stabilization system would."""
        for bend in self.sharp_bends:
            lo = bend["theta_center"] - bend["half_width"]
            hi = bend["theta_center"] + bend["half_width"]
            worst = min(
                self._instantaneous_curvature_radius(lo + (hi - lo) * i / (samples - 1))
                for i in range(samples)
            )
            bend["min_curvature_radius"] = worst

    # ------------------------------------------------------------ geometry
    def _spiral_radius(self, theta: float) -> float:
        return self.r_outer - (self.r_outer - self.r_inner) * (theta / self.theta_max)

    def _bend_perturbation(self, theta: float) -> float:
        total = 0.0
        for bend in self.sharp_bends:
            d = theta - bend["theta_center"]
            hw = bend["half_width"]
            if abs(d) <= hw:
                # raised-cosine bump: smooth 0 -> amplitude -> 0 across the window
                total += bend["amplitude_m"] * 0.5 * (1 + math.cos(math.pi * d / hw))
        return total

    def radius_at(self, theta: float) -> float:
        theta = max(0.0, min(self.theta_max, theta))
        r = self._spiral_radius(theta) + self._bend_perturbation(theta)
        return max(15.0, min(self.r_outer + 60.0, r))

    def elevation_at(self, theta: float) -> float:
        theta = max(0.0, min(self.theta_max, theta))
        return self.elev_surface - (self.elev_surface - self.elev_pit) * (theta / self.theta_max)

    def point_at(self, theta: float) -> tuple[float, float]:
        r = self.radius_at(theta)
        return self.cx + r * math.cos(theta), self.cy + r * math.sin(theta)

    def heading_at(self, theta: float, direction_sign: int) -> float:
        # numerical tangent so it stays correct through the sharp-bend perturbations
        eps = 0.01
        x0, y0 = self.point_at(max(0.0, theta - eps))
        x1, y1 = self.point_at(min(self.theta_max, theta + eps))
        base = math.degrees(math.atan2(y1 - y0, x1 - x0))
        if direction_sign < 0:
            base += 180.0
        return (base + 360.0) % 360.0

    def bench_at(self, theta: float) -> str:
        idx = int(theta / (2 * math.pi))
        idx = max(0, min(len(self.bench_names) - 1, idx))
        return self.bench_names[idx]

    def _instantaneous_curvature_radius(self, theta: float) -> float:
        """Three-point circumradius of the traced road at `theta`."""
        eps = 0.015
        lo, hi = max(0.0, theta - eps), min(self.theta_max, theta + eps)
        ax, ay = self.point_at(lo)
        bx, by = self.point_at(theta)
        cx, cy = self.point_at(hi)

        a = math.hypot(bx - cx, by - cy)
        b = math.hypot(ax - cx, ay - cy)
        c = math.hypot(ax - bx, ay - by)
        area2 = abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay))  # 2x triangle area
        if area2 < 1e-6:
            return self.r_outer * 2  # effectively straight here
        radius = (a * b * c) / (2 * area2)
        return max(10.0, min(self.r_outer * 2, radius))

    def curvature_radius_at(self, theta: float) -> float:
        """Radius of curvature used by the speed advisor. Outside any
        flagged bend, this is the smooth instantaneous curvature of the
        plain spiral (so speed ramps continuously on the approach). Inside
        a flagged bend, it's that bend's precomputed worst-case radius —
        held flat across the whole window — so the recommended speed
        doesn't flicker on the brief straightening inflection a tight
        raised-cosine bend has right next to its sharpest point."""
        for bend in self.sharp_bends:
            if abs(theta - bend["theta_center"]) <= bend["half_width"]:
                return bend["min_curvature_radius"]
        return self._instantaneous_curvature_radius(theta)

    # ------------------------------------------------------------ zones
    def zone_at(self, theta: float) -> Zone:
        for bend in self.sharp_bends:
            if abs(theta - bend["theta_center"]) <= bend["half_width"]:
                return Zone(bend["zone_type"], bend["name"], bend.get("kind", ""))
        if abs(theta - self.intersection_theta) <= self.intersection_half_width:
            return Zone("intersection", ZONE_LABELS["intersection"])
        if abs(theta - self.ramp_node_theta) <= self.ramp_half_width:
            return Zone("ramp", ZONE_LABELS["ramp"])
        if self.dumping_window[0] <= theta <= self.dumping_window[1]:
            return Zone("dumping", ZONE_LABELS["dumping"])
        if self.loading_window[0] <= theta <= self.loading_window[1]:
            return Zone("loading", ZONE_LABELS["loading"])
        return Zone("bench_road", ZONE_LABELS["bench_road"])

    def is_gps_denied(self, theta: float) -> bool:
        return self.gps_denied_window[0] <= theta <= self.gps_denied_window[1]

    # ------------------------------------------------------------ V2I
    def _build_v2i_nodes(self) -> list[V2INode]:
        specs = [
            ("RSU-01", "Blind Curve RSU", "blind_curve", self.blind_curve_center),
            ("RSU-02", "Intersection RSU", "intersection", self.intersection_theta),
            ("RSU-03", "Ramp RSU", "ramp", self.ramp_node_theta),
            ("RSU-04", "Dumping Area RSU", "dumping", (self.dumping_window[0] + self.dumping_window[1]) / 2),
            ("RSU-05", "Loading Area RSU", "loading", (self.loading_window[0] + self.loading_window[1]) / 2),
            ("RSU-06", "GPS-Denied Zone RSU", "gps_denied", (self.gps_denied_window[0] + self.gps_denied_window[1]) / 2),
        ]
        nodes = []
        for node_id, name, zone_type, theta in specs:
            x, y = self.point_at(theta)
            nodes.append(V2INode(node_id, name, zone_type, theta, x, y))
        return nodes

    def nearest_v2i_node(self, theta: float) -> tuple[V2INode, float]:
        """Returns the nearest V2I node and the approximate road-distance to it (m)."""
        best, best_gap = None, None
        for node in self.v2i_nodes:
            gap = self.road_distance(theta, node.theta)
            if best_gap is None or gap < best_gap:
                best, best_gap = node, gap
        return best, best_gap

    # ------------------------------------------------------------ distance
    def road_distance(self, theta_a: float, theta_b: float) -> float:
        """Approximate along-road distance (m) between two theta positions."""
        r_mid = (self.radius_at(theta_a) + self.radius_at(theta_b)) / 2
        return abs(theta_a - theta_b) * r_mid

    # ------------------------------------------------------------ serialization
    def to_dict(self, samples_per_turn: int = 40) -> dict:
        n = max(2, int(self.turns * samples_per_turn))
        points = []
        for i in range(n + 1):
            theta = self.theta_max * i / n
            x, y = self.point_at(theta)
            points.append([round(x, 1), round(y, 1), round(theta, 4), round(self.elevation_at(theta), 1)])

        # one zone entry per real bend — this is the same list zone_at() and
        # the curvature/geometry math use, so the digital twin can never
        # show a bend that vehicles don't actually slow down for
        zones = [
            {"type": bend["zone_type"], "name": bend["name"], "kind": bend.get("kind", ""),
             "notable": bend.get("notable", True),
             "theta_start": bend["theta_center"] - bend["half_width"],
             "theta_end": bend["theta_center"] + bend["half_width"]}
            for bend in self.sharp_bends
        ]
        zones += [
            {"type": "intersection", "name": ZONE_LABELS["intersection"], "kind": "", "notable": True,
             "theta_start": self.intersection_theta - self.intersection_half_width,
             "theta_end": self.intersection_theta + self.intersection_half_width},
            {"type": "dumping", "name": ZONE_LABELS["dumping"], "kind": "", "notable": True,
             "theta_start": self.dumping_window[0], "theta_end": self.dumping_window[1]},
            {"type": "loading", "name": ZONE_LABELS["loading"], "kind": "", "notable": True,
             "theta_start": self.loading_window[0], "theta_end": self.loading_window[1]},
            {"type": "gps_denied", "name": "GPS-Denied Zone", "kind": "", "notable": True,
             "theta_start": self.gps_denied_window[0], "theta_end": self.gps_denied_window[1]},
        ]

        return {
            "center": [self.cx, self.cy],
            "outer_radius_m": self.r_outer,
            "inner_radius_m": self.r_inner,
            "turns": self.turns,
            "theta_max": self.theta_max,
            "elevation_surface_m": self.elev_surface,
            "elevation_pit_m": self.elev_pit,
            "bench_names": self.bench_names,
            "points": points,
            "zones": zones,
            "v2i_nodes": [
                {"id": n.node_id, "name": n.name, "type": n.zone_type,
                 "theta": round(n.theta, 4), "x": round(n.x, 1), "y": round(n.y, 1)}
                for n in self.v2i_nodes
            ],
        }

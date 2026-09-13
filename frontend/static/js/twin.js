/**
 * Digital-twin renderer for the FOGNET spiral open-pit mine.
 *
 * The mine is drawn as concentric stepped benches (annular bands,
 * outer = surface down to inner = pit floor) with the haul road drawn
 * as the actual spiral curve on top of them — this is what gives the
 * twin real depth instead of a flat loop. Terrain never changes
 * between ticks, so it's built once onto an offscreen canvas and
 * reused; only fog, V2X links, and the 5 trucks redraw every frame.
 */
const TWIN_W = 860;
const TWIN_H = 680;

const VEHICLE_COLORS = {
  GREEN: "#2ecc71",
  YELLOW: "#f1c40f",
  ORANGE: "#e67e22",
  RED: "#e74c3c",
};

// bench bands, outermost (surface/jungle) -> innermost (ore-bearing rock near pit)
const BENCH_COLORS = ["#2c4a25", "#4a5a2e", "#6b6238", "#7a5638", "#7a4530"];
const OUTER_FRINGE_COLOR = "#1c3318";
const PIT_FLOOR_COLOR = "#241a14";

// icon per zone TYPE; the label text itself comes from each zone's own
// `name` (so a hairpin, a tight 90° bend and a high-risk curve — all
// zone_type "sharp_curve" — still get distinct on-map labels)
const ZONE_ICON_BY_TYPE = {
  blind_curve: "⚠️",
  sharp_curve: "↩️",
  intersection: "✚",
  ramp: "⛰️",
  loading: "⛏️",
  dumping: "🪨",
};

let _terrainCanvas = null;
let _terrainKey = null;
let _roadCache = null;

function initTwinCanvas(canvas) {
  canvas.width = TWIN_W;
  canvas.height = TWIN_H;
  return canvas.getContext("2d");
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function radiusAt(road, theta) {
  return road.outer_radius_m - (road.outer_radius_m - road.inner_radius_m) * (theta / road.theta_max);
}

function pointAtTheta(road, theta) {
  const r = radiusAt(road, theta);
  return [road.center[0] + r * Math.cos(theta), road.center[1] + r * Math.sin(theta)];
}

function drawTree(ctx, x, y, s, rand) {
  ctx.fillStyle = "#241d12";
  ctx.fillRect(x - 0.6 * s, y, 1.2 * s, 2 * s);
  ctx.fillStyle = `rgb(${35 + rand() * 18},${65 + rand() * 22},${28 + rand() * 14})`;
  ctx.beginPath();
  ctx.moveTo(x, y - 4 * s);
  ctx.lineTo(x - 2.8 * s, y + 0.6 * s);
  ctx.lineTo(x + 2.8 * s, y + 0.6 * s);
  ctx.closePath();
  ctx.fill();
}

function drawRockOutcrop(ctx, x, y, r, rand) {
  ctx.fillStyle = "#4a4038";
  ctx.beginPath();
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.75 + rand() * 0.4);
    const px = x + Math.cos(a) * rr,
      py = y + Math.sin(a) * rr;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(15,12,10,0.5)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawChevronSign(ctx, x, y, headingRad, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(headingRad);
  ctx.fillStyle = "#111820";
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-3, -9, 16, 18, 2);
  else ctx.rect(-3, -9, 16, 18);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(1, -6);
  ctx.lineTo(8, 0);
  ctx.lineTo(1, 6);
  ctx.stroke();
  ctx.restore();
}

function buildTerrain(road) {
  const canvas = document.createElement("canvas");
  canvas.width = TWIN_W;
  canvas.height = TWIN_H;
  const ctx = canvas.getContext("2d");
  const rand = mulberry32(11);
  const [cx, cy] = road.center;
  const spacing = (road.outer_radius_m - road.inner_radius_m) / road.turns;

  ctx.fillStyle = "#0e1520";
  ctx.fillRect(0, 0, TWIN_W, TWIN_H);

  // outer forest fringe beyond the mine rim
  ctx.fillStyle = OUTER_FRINGE_COLOR;
  ctx.beginPath();
  ctx.arc(cx, cy, road.outer_radius_m + 90, 0, Math.PI * 2);
  ctx.fill();

  // concentric stepped benches, outer -> inner
  for (let k = 0; k < road.turns; k++) {
    const rOut = road.outer_radius_m - k * spacing;
    ctx.fillStyle = BENCH_COLORS[Math.min(k, BENCH_COLORS.length - 1)];
    ctx.beginPath();
    ctx.arc(cx, cy, rOut, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(15,12,8,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // pit floor
  ctx.fillStyle = PIT_FLOOR_COLOR;
  ctx.beginPath();
  ctx.arc(cx, cy, road.inner_radius_m, 0, Math.PI * 2);
  ctx.fill();

  const pondGrad = ctx.createRadialGradient(cx - 6, cy - 6, 3, cx, cy, road.inner_radius_m * 0.6);
  pondGrad.addColorStop(0, "#3f8f94");
  pondGrad.addColorStop(1, "#123a3d");
  ctx.fillStyle = pondGrad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, road.inner_radius_m * 0.6, road.inner_radius_m * 0.44, 0, 0, Math.PI * 2);
  ctx.fill();

  // trees scattered on the outer surface bench + fringe
  for (let i = 0; i < 110; i++) {
    const a = rand() * Math.PI * 2;
    const r = road.outer_radius_m + rand() * 70 - spacing * (rand() * 0.6);
    if (r < road.outer_radius_m - spacing) continue;
    drawTree(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.5 + rand() * 1.6, rand);
  }

  // curve zones (all of them, keyed by theta range) — used to paint a
  // warning-colored halo under the road at every sharp/blind bend, so
  // the bend is obvious at a glance instead of only visible as a subtle
  // geometric kink
  const curveZones = road.zones.filter((z) => z.type === "sharp_curve" || z.type === "blind_curve");
  function curveZoneAt(theta) {
    return curveZones.find((z) => theta >= z.theta_start && theta <= z.theta_end) || null;
  }
  const CURVE_HALO_COLOR = { sharp_curve: "rgba(241,196,15,0.55)", blind_curve: "rgba(231,76,60,0.6)" };

  // the spiral haul road itself
  const pts = road.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i],
      b = pts[i + 1];
    const midTheta = (a[2] + b[2]) / 2;
    const curveZone = curveZoneAt(midTheta);

    if (curveZone) {
      ctx.strokeStyle = CURVE_HALO_COLOR[curveZone.type];
      ctx.lineWidth = 34;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }

    ctx.strokeStyle = "#1c1712";
    ctx.lineWidth = 22;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();

    ctx.strokeStyle = curveZone ? (curveZone.type === "blind_curve" ? "#a05840" : "#a08a4a") : "#9c9080";
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,214,51,0.75)";
    ctx.lineWidth = 1.6;
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.setLineDash([]);

    // white edge curbs
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const ex = (-dy / len) * 8,
      ey = (dx / len) * 8;
    ctx.strokeStyle = "rgba(238,235,224,0.8)";
    ctx.lineWidth = 1.1;
    [1, -1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(a[0] + ex * side, a[1] + ey * side);
      ctx.lineTo(b[0] + ex * side, b[1] + ey * side);
      ctx.stroke();
    });
  }

  // chevron curve-warning signs — the same universal ">" road markers real
  // mountain/mine hairpins use, so every sharp/blind bend reads instantly
  // as "curve ahead" instead of relying on the reader spotting the kink
  curveZones.forEach((zone) => {
    const color = zone.type === "blind_curve" ? "#ff5a3c" : "#ffd633";
    const width = zone.theta_end - zone.theta_start;
    [0.18, 0.5, 0.82].forEach((frac) => {
      const theta = zone.theta_start + width * frac;
      const [px, py] = pointAtTheta(road, theta);
      const [tx, ty] = pointAtTheta(road, theta + 0.01);
      const heading = Math.atan2(ty - py, tx - px);
      const r = radiusAt(road, theta);
      const ox = px + ((px - cx) / r) * 26,
        oy = py + ((py - cy) / r) * 26;
      drawChevronSign(ctx, ox, oy, heading, color);
    });
  });

  // blind-curve rock walls blocking the sightline around each blind bend
  road.zones.filter((z) => z.type === "blind_curve").forEach((blindZone) => {
    const midTheta = (blindZone.theta_start + blindZone.theta_end) / 2;
    const [wx, wy] = pointAtTheta(road, midTheta);
    const rMid = radiusAt(road, midTheta);
    const ox = wx + ((wx - cx) / rMid) * 22,
      oy = wy + ((wy - cy) / rMid) * 22;
    drawRockOutcrop(ctx, ox, oy, 26, rand);
    drawRockOutcrop(ctx, ox - 14, oy + 10, 16, rand);
    drawRockOutcrop(ctx, ox + 16, oy - 8, 14, rand);
  });

  // smaller boulder accents at every other sharp bend (not a full blind wall,
  // just visual emphasis that the curvature genuinely tightens here) — S-curve
  // sweeps stay clear of rock so they read as smooth esses, not hairpins
  road.zones.filter((z) => z.type === "sharp_curve" && z.kind !== "s_curve").forEach((zone) => {
    const midTheta = (zone.theta_start + zone.theta_end) / 2;
    const [sx, sy] = pointAtTheta(road, midTheta);
    const rMid = radiusAt(road, midTheta);
    const sox = sx + ((sx - cx) / rMid) * 18,
      soy = sy + ((sy - cy) / rMid) * 18;
    const size = zone.kind === "high_risk" ? 17 : 14;
    drawRockOutcrop(ctx, sox, soy, size, rand);
    drawRockOutcrop(ctx, sox - 10, soy + 6, size * 0.65, rand);
  });

  // intersection junction stub (a short spur, not a road trucks use)
  const xZone = road.zones.find((z) => z.type === "intersection");
  if (xZone) {
    const midTheta = (xZone.theta_start + xZone.theta_end) / 2;
    const [ix, iy] = pointAtTheta(road, midTheta);
    const rMid = radiusAt(road, midTheta);
    const stubX = ix + ((ix - cx) / rMid) * 34,
      stubY = iy + ((iy - cy) / rMid) * 34;
    ctx.strokeStyle = "#6b6050";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(ix, iy);
    ctx.lineTo(stubX, stubY);
    ctx.stroke();
    ctx.fillStyle = "#7a6f5c";
    ctx.beginPath();
    ctx.arc(stubX, stubY, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  // GPS-denied shadow band, marked statically on the map
  const gpsZone = road.zones.find((z) => z.type === "gps_denied");
  if (gpsZone) {
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const theta = gpsZone.theta_start + (gpsZone.theta_end - gpsZone.theta_start) * (i / steps);
      const [px, py] = pointAtTheta(road, theta);
      ctx.fillStyle = "rgba(120,40,40,0.28)";
      ctx.beginPath();
      ctx.arc(px, py, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    const midTheta = (gpsZone.theta_start + gpsZone.theta_end) / 2;
    drawTag(ctx, road, midTheta, "📡 GPS-DENIED ZONE", "rgba(120,40,40,0.85)");
  }

  // zone tags — only "notable" zones get a map label (S-curve halves are
  // merged into one tag) so the map stays legible instead of cluttered
  const taggedSCurve = { done: false };
  road.zones.forEach((zone) => {
    const icon = ZONE_ICON_BY_TYPE[zone.type];
    if (!icon) return;
    if (zone.kind === "s_curve") {
      if (taggedSCurve.done) return;
      taggedSCurve.done = true;
      drawTag(ctx, road, (zone.theta_start + zone.theta_end) / 2, `${icon} S-CURVE`, "rgba(10,10,8,0.65)");
      return;
    }
    if (!zone.notable) return;
    const midTheta = (zone.theta_start + zone.theta_end) / 2;
    drawTag(ctx, road, midTheta, `${icon} ${zone.name.toUpperCase()}`, "rgba(10,10,8,0.65)");
  });

  // roadside V2I infrastructure units (RSUs)
  road.v2i_nodes.forEach((node) => {
    ctx.fillStyle = "#e8e2d0";
    ctx.strokeStyle = "#3fa9f5";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(node.x - 5, node.y - 10, 10, 14);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(node.x, node.y - 10);
    ctx.lineTo(node.x, node.y - 17);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(node.x, node.y - 17, 2, 0, Math.PI * 2);
    ctx.fillStyle = "#3fa9f5";
    ctx.fill();

    ctx.font = "bold 9px Consolas, monospace";
    const w = ctx.measureText(node.id).width + 8;
    ctx.fillStyle = "rgba(10,14,20,0.75)";
    ctx.fillRect(node.x - w / 2, node.y + 6, w, 12);
    ctx.fillStyle = "#3fa9f5";
    ctx.fillText(node.id, node.x - w / 2 + 4, node.y + 15);
  });

  return canvas;
}

function drawTag(ctx, road, theta, text, bg) {
  const [x, y] = pointAtTheta(road, theta);
  const r = radiusAt(road, theta);
  const [cx, cy] = road.center;
  const ox = x + ((x - cx) / r) * 46,
    oy = y + ((y - cy) / r) * 46;
  ctx.font = "11px Segoe UI Emoji, Segoe UI, sans-serif";
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = bg;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(ox - w / 2, oy - 10, w, 18, 4);
  else ctx.rect(ox - w / 2, oy - 10, w, 18);
  ctx.fill();
  ctx.fillStyle = "#f2ead6";
  ctx.fillText(text, ox - w / 2 + 6, oy + 3);
}

function getTerrain(road) {
  const key = road.theta_max + ":" + road.points.length;
  if (_terrainCanvas && _terrainKey === key) return _terrainCanvas;
  _terrainCanvas = buildTerrain(road);
  _terrainKey = key;
  _roadCache = road;
  return _terrainCanvas;
}

function drawTruck(ctx, v, selected) {
  const color = VEHICLE_COLORS[v.hazard_status] || "#3fa9f5";
  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.rotate((v.heading_deg * Math.PI) / 180);

  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(1, 2, 15, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#111";
  [[-9, -8], [-9, 8], [6, -8], [6, 8]].forEach(([wx, wy]) => {
    ctx.beginPath();
    ctx.arc(wx, wy, 2.6, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = color;
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.rect(-13, -7, 17, 14);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#2b2f36";
  ctx.beginPath();
  ctx.rect(4, -5.5, 9, 11);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 19, 0, Math.PI * 2);
  ctx.stroke();

  if (selected) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.6;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(0, 0, 25, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  ctx.fillStyle = "rgba(10,10,8,0.68)";
  ctx.fillRect(v.x - 30, v.y - 34, 60, 13);
  ctx.fillStyle = "#f2ead6";
  ctx.font = "bold 11px Segoe UI";
  ctx.fillText(v.id, v.x - 27, v.y - 24);

  ctx.fillStyle = "rgba(10,10,8,0.68)";
  ctx.fillRect(v.x - 24, v.y + 22, 48, 13);
  ctx.fillStyle = "#dcd2ba";
  ctx.font = "10px Segoe UI";
  ctx.fillText(`${v.speed_kmh} km/h`, v.x - 20, v.y + 31);
}

function drawTwin(ctx, state, opts) {
  const road = state.road;
  if (!road) {
    ctx.clearRect(0, 0, TWIN_W, TWIN_H);
    return;
  }
  opts = opts || {};

  ctx.drawImage(getTerrain(road), 0, 0);

  const globalVis = state.fog ? state.fog.visibility_m : 200;
  const blindVis = state.fog && state.fog.zones ? state.fog.zones.blind_curve.visibility_m : globalVis;

  // ambient haze across the whole mine
  const ambientSeverity = Math.max(0, Math.min(1, 1 - globalVis / 190));
  if (ambientSeverity > 0.03) {
    ctx.fillStyle = `rgba(210,220,230,${(ambientSeverity * 0.4).toFixed(2)})`;
    ctx.fillRect(0, 0, TWIN_W, TWIN_H);
  }

  // extra dense localized cloud over every blind curve — always the foggiest spots
  road.zones.filter((z) => z.type === "blind_curve").forEach((blindZone) => {
    const midTheta = (blindZone.theta_start + blindZone.theta_end) / 2;
    const [bx, by] = pointAtTheta(road, midTheta);
    const intensity = Math.max(0, Math.min(0.88, 1 - blindVis / 190));
    if (intensity > 0.03) {
      const grad = ctx.createRadialGradient(bx, by, 5, bx, by, 130);
      grad.addColorStop(0, `rgba(232,236,240,${intensity})`);
      grad.addColorStop(1, "rgba(232,236,240,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, TWIN_W, TWIN_H);
    }
  });

  if (opts.showLinks !== false) {
    (state.v2v_messages || []).forEach((m) => {
      const s = state.vehicles[m.sender];
      const r = state.vehicles[m.receiver];
      if (!s || !r) return;
      ctx.strokeStyle = "rgba(63,169,245,0.55)";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(r.x, r.y);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // V2I connection lines
    Object.entries(state.v2i || {}).forEach(([vid, info]) => {
      if (!info.connected || !info.node) return;
      const v = state.vehicles[vid];
      const node = road.v2i_nodes.find((n) => n.id === info.node.id);
      if (!v || !node) return;
      ctx.strokeStyle = "rgba(46,204,113,0.5)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(v.x, v.y);
      ctx.lineTo(node.x, node.y - 17);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  Object.values(state.vehicles || {}).forEach((v) => drawTruck(ctx, v, v.id === opts.selectedId));
}

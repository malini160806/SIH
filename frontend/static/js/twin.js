/**
 * 2D digital-twin renderer for the mine haul-road loop.
 *
 * Visual features:
 *  - Terrain: radial bg gradient, dot grid, decorative mine structures
 *  - Road: shadow, surface, edge highlights, dashed center line
 *  - Fog zones: localised animated cloud puffs (NO global white overlay)
 *  - Vehicles: truck body, cab, headlights, status glow ring, sensor cone
 *  - V2V: animated dash + travelling data-packet dot
 *  - HUD: fog-status badge (top-left), live legend (bottom-right), compass (top-right)
 */
const TWIN_W = 860;
const TWIN_H = 680;

const ZONE_COLORS = {
  straight:     "#1e3148",
  curve:        "#3d2752",
  intersection: "#4d3f18",
  loading:      "#1a4d30",
  dumping:      "#4d2c18",
};

const ZONE_ICONS = {
  loading:      "⛏",
  dumping:      "🪨",
  curve:        "↩",
  intersection: "✦",
};

const VEHICLE_COLORS = {
  GREEN:  "#2ecc71",
  YELLOW: "#f1c40f",
  ORANGE: "#e67e22",
  RED:    "#e74c3c",
};

/* ── localised fog-cloud particles (spawned near fog-zone segments) ── */
let fogClouds = [];            // {x,y,r,dx,dy,phase}
let fogCloudsInited = false;

function initFogClouds(fogZoneSegments) {
  fogClouds = [];
  fogCloudsInited = true;
  for (const seg of fogZoneSegments) {
    const [ax, ay] = seg.a;
    const [bx, by] = seg.b;
    const count = 18;          // particles per fog segment
    for (let i = 0; i < count; i++) {
      const t = Math.random();
      fogClouds.push({
        x: ax + (bx - ax) * t + (Math.random() - 0.5) * 80,
        y: ay + (by - ay) * t + (Math.random() - 0.5) * 80,
        r: 25 + Math.random() * 50,
        dx: (Math.random() - 0.5) * 0.35,
        dy: (Math.random() - 0.5) * 0.12,
        phase: Math.random() * Math.PI * 2,
        // keep reference to home so they stay near fog zone
        homeX: ax + (bx - ax) * t,
        homeY: ay + (by - ay) * t,
      });
    }
  }
}

function stepFogClouds() {
  for (const p of fogClouds) {
    p.x += p.dx;
    p.y += p.dy;
    p.phase += 0.015;
    // gently pull back toward home so they don't drift away
    p.x += (p.homeX - p.x) * 0.003;
    p.y += (p.homeY - p.y) * 0.003;
  }
}

/* ── animation frame counter ── */
let _twinFrame = 0;

function initTwinCanvas(canvas) {
  canvas.width = TWIN_W;
  canvas.height = TWIN_H;
  return canvas.getContext("2d");
}

function lerp(a, b, t) { return a + (b - a) * t; }

/* ────────────────────── MAIN DRAW ────────────────────── */
function drawTwin(ctx, state) {
  _twinFrame++;
  stepFogClouds();

  ctx.clearRect(0, 0, TWIN_W, TWIN_H);

  /* ── background ── */
  const bgGrad = ctx.createRadialGradient(TWIN_W / 2, TWIN_H / 2, 80, TWIN_W / 2, TWIN_H / 2, TWIN_W * 0.72);
  bgGrad.addColorStop(0, "#101d2a");
  bgGrad.addColorStop(1, "#080d12");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, TWIN_W, TWIN_H);

  /* ── terrain dot grid ── */
  ctx.fillStyle = "rgba(90,130,170,0.05)";
  for (let gx = 0; gx < TWIN_W; gx += 38) {
    for (let gy = 0; gy < TWIN_H; gy += 38) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ── decorative terrain features (static) ── */
  drawTerrainFeatures(ctx);

  const road = state.road;
  if (!road) return;
  const pts = road.points;
  const zones = road.zones;
  const fogStatus = state.fog ? state.fog.status : "CLEAR";
  const visibility = state.fog ? state.fog.visibility_m : 200;

  /* ── initialise localised fog clouds from road data (once) ── */
  if (!fogCloudsInited) {
    const segs = [];
    for (let i = 0; i < pts.length; i++) {
      if (zones[i].is_fog_zone) {
        segs.push({ a: pts[i], b: pts[(i + 1) % pts.length] });
      }
    }
    initFogClouds(segs);
  }

  /* ── road segments ── */
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const zone = zones[i];

    // shadow
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 30;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(a[0] + 2, a[1] + 3);
    ctx.lineTo(b[0] + 2, b[1] + 3);
    ctx.stroke();

    // asphalt surface
    ctx.strokeStyle = ZONE_COLORS[zone.type] || "#1e3148";
    ctx.lineWidth = 26;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();

    // edge markings (white dashed)
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 28;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();

    // center dashed line
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 10]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.setLineDash([]);

    // fog-zone road highlight (subtle animated glow on ROAD only, NOT entire canvas)
    if (zone.is_fog_zone) {
      const base = { CLEAR: 0.02, LIGHT: 0.08, MEDIUM: 0.14, HEAVY: 0.22, EXTREME: 0.32 }[fogStatus] || 0.03;
      const pulse = Math.sin(_twinFrame * 0.035) * 0.04;
      ctx.strokeStyle = `rgba(150,200,255,${Math.max(0, base + pulse)})`;
      ctx.lineWidth = 44;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  }

  /* ── zone labels with pill background ── */
  const labeled = new Set();
  for (let i = 0; i < pts.length; i++) {
    const zone = zones[i];
    if (["loading", "dumping", "curve", "intersection"].includes(zone.type) && !labeled.has(zone.type)) {
      labeled.add(zone.type);
      const p = pts[i];
      const icon = ZONE_ICONS[zone.type] || "";
      const labelText = `${icon} ${zone.name.toUpperCase()}`;
      ctx.font = "bold 10px Segoe UI";
      const tw = ctx.measureText(labelText).width;
      const lx = p[0] - tw / 2 - 6;
      const ly = p[1] - 32;
      ctx.fillStyle = "rgba(8,12,18,0.82)";
      ctx.beginPath();
      ctx.roundRect(lx, ly, tw + 12, 18, 4);
      ctx.fill();
      ctx.strokeStyle = "rgba(100,140,180,0.2)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.roundRect(lx, ly, tw + 12, 18, 4);
      ctx.stroke();
      ctx.fillStyle = "#a8c0d8";
      ctx.fillText(labelText, lx + 6, ly + 13);
    }
  }

  /* ── V2V communication arcs ── */
  const msgs = state.v2v_messages || [];
  msgs.forEach((m) => {
    const s = state.vehicles[m.sender];
    const r = state.vehicles[m.receiver];
    if (!s || !r) return;

    const t = (_twinFrame * 0.06) % 1;
    // glow
    ctx.strokeStyle = `rgba(63,169,245,${0.12 + Math.sin(t * Math.PI * 2) * 0.08})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(r.x, r.y);
    ctx.stroke();

    // animated dashes
    ctx.strokeStyle = "rgba(63,169,245,0.5)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 6]);
    ctx.lineDashOffset = -_twinFrame * 0.7;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(r.x, r.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // travelling packet dot
    const px = lerp(s.x, r.x, t);
    const py = lerp(s.y, r.y, t);
    ctx.fillStyle = "#3fa9f5";
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(63,169,245,0.25)";
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fill();
  });

  /* ── vehicles ── */
  Object.values(state.vehicles || {}).forEach((v) => {
    const color = VEHICLE_COLORS[v.hazard_status] || "#3fa9f5";

    // outer glow
    ctx.save();
    ctx.translate(v.x, v.y);
    const gg = ctx.createRadialGradient(0, 0, 4, 0, 0, 26);
    gg.addColorStop(0, color + "40"); // 25% alpha hex
    gg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // sensor cone (forward)
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate((v.heading_deg * Math.PI) / 180);
    const sensorRange = Math.min(visibility * 0.35, 55);
    const sensorAlpha = v.hazard_status === "RED" ? 0.12 : 0.05;
    const sensorCol = v.hazard_status === "RED" ? `rgba(231,76,60,${sensorAlpha})` : `rgba(63,169,245,${sensorAlpha})`;
    ctx.fillStyle = sensorCol;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, sensorRange, -Math.PI * 0.28, Math.PI * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // truck body
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate((v.heading_deg * Math.PI) / 180);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-10, -6, 20, 12, 3);
    ctx.fill();
    // cab
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(10, -4);
    ctx.lineTo(15, 0);
    ctx.lineTo(10, 4);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1.0;
    // headlights
    ctx.fillStyle = "#ffe";
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(14, -2, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(14, 2, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;
    // status ring
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, Math.PI * 2);
    ctx.stroke();
    // RED pulsing ring
    if (v.hazard_status === "RED") {
      const pr = 17 + Math.sin(_twinFrame * 0.14) * 4;
      ctx.strokeStyle = `rgba(231,76,60,${0.25 + Math.sin(_twinFrame * 0.14) * 0.18})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, pr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // label
    ctx.fillStyle = "#dce8f0";
    ctx.font = "bold 11px Segoe UI";
    ctx.fillText(v.id, v.x - 24, v.y - 24);
    // speed pill
    const spd = `${v.speed_kmh} km/h`;
    ctx.font = "10px Segoe UI";
    const sw = ctx.measureText(spd).width;
    ctx.fillStyle = "rgba(8,12,18,0.65)";
    ctx.beginPath();
    ctx.roundRect(v.x - sw / 2 - 4, v.y + 22, sw + 8, 14, 3);
    ctx.fill();
    ctx.fillStyle = "#8a9bb0";
    ctx.fillText(spd, v.x - sw / 2, v.y + 33);
  });

  /* ── LOCALISED FOG CLOUDS (only near fog zones, NOT global) ── */
  const fogAlphaMap = { CLEAR: 0, LIGHT: 0.10, MEDIUM: 0.22, HEAVY: 0.40, EXTREME: 0.62 };
  const fogAlpha = fogAlphaMap[fogStatus] || 0;
  if (fogAlpha > 0.01) {
    for (const p of fogClouds) {
      const breathe = 0.5 + 0.5 * Math.sin(p.phase);
      const a = fogAlpha * breathe * 0.18;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, `rgba(190,210,235,${a})`);
      g.addColorStop(0.6, `rgba(190,210,235,${a * 0.4})`);
      g.addColorStop(1, "rgba(190,210,235,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ── NO global white overlay — fog is ONLY the localised clouds above ── */

  /* ── HUD: fog badge (top-left) ── */
  const badgeColors = { CLEAR: "#2ecc71", LIGHT: "#9be15d", MEDIUM: "#f1c40f", HEAVY: "#e67e22", EXTREME: "#e74c3c" };
  const bc = badgeColors[fogStatus] || "#2ecc71";
  const bt = `FOG: ${fogStatus}  ·  ${visibility} m`;
  ctx.font = "bold 11px Segoe UI";
  const btw = ctx.measureText(bt).width;
  ctx.fillStyle = "rgba(8,12,18,0.88)";
  ctx.beginPath();
  ctx.roundRect(10, 10, btw + 30, 26, 5);
  ctx.fill();
  ctx.strokeStyle = "rgba(100,140,180,0.15)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.roundRect(10, 10, btw + 30, 26, 5);
  ctx.stroke();
  ctx.fillStyle = bc;
  ctx.beginPath();
  ctx.arc(24, 23, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ccdae8";
  ctx.fillText(bt, 34, 28);

  /* ── HUD: compass (top-right) ── */
  drawCompass(ctx, TWIN_W - 40, 40, 22);

  /* ── HUD: legend (bottom-right) ── */
  const lx = TWIN_W - 148;
  const ly = TWIN_H - 100;
  ctx.fillStyle = "rgba(8,12,18,0.84)";
  ctx.beginPath();
  ctx.roundRect(lx, ly, 138, 90, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(100,140,180,0.15)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.roundRect(lx, ly, 138, 90, 6);
  ctx.stroke();
  ctx.font = "bold 9px Segoe UI";
  ctx.fillStyle = "#5a7a95";
  ctx.fillText("STATUS LEGEND", lx + 8, ly + 14);
  const items = [
    { c: "#2ecc71", l: "Safe" },
    { c: "#f1c40f", l: "Caution" },
    { c: "#e67e22", l: "High Risk" },
    { c: "#e74c3c", l: "Critical" },
  ];
  ctx.font = "10px Segoe UI";
  items.forEach((it, i) => {
    const iy = ly + 28 + i * 15;
    ctx.fillStyle = it.c;
    ctx.beginPath();
    ctx.arc(lx + 14, iy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#9fb3c8";
    ctx.fillText(it.l, lx + 24, iy + 4);
  });
}

/* ── terrain features (mine buildings, signal tower, etc.) ── */
function drawTerrainFeatures(ctx) {
  // signal tower (top-left area)
  drawTower(ctx, 60, 80);
  drawTower(ctx, TWIN_W - 80, TWIN_H - 100);

  // mine building silhouettes
  drawBuilding(ctx, 140, 50, 30, 18);
  drawBuilding(ctx, TWIN_W - 120, 55, 24, 14);
  drawBuilding(ctx, 80, TWIN_H - 60, 28, 16);

  // rock scatter
  drawRocks(ctx, 700, 120);
  drawRocks(ctx, 180, 520);
  drawRocks(ctx, 550, 580);
}

function drawTower(ctx, x, y) {
  ctx.strokeStyle = "rgba(80,120,160,0.15)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 28);
  ctx.stroke();
  // cross bars
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 20);
  ctx.lineTo(x + 6, y - 20);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 4, y - 10);
  ctx.lineTo(x + 4, y - 10);
  ctx.stroke();
  // blinking light
  const blink = Math.sin(_twinFrame * 0.08) > 0;
  ctx.fillStyle = blink ? "rgba(231,76,60,0.6)" : "rgba(231,76,60,0.15)";
  ctx.beginPath();
  ctx.arc(x, y - 28, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawBuilding(ctx, x, y, w, h) {
  ctx.fillStyle = "rgba(60,90,120,0.08)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(80,120,160,0.1)";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, w, h);
  // windows
  ctx.fillStyle = "rgba(63,169,245,0.08)";
  for (let wx = x + 4; wx < x + w - 4; wx += 8) {
    ctx.fillRect(wx, y + 4, 4, 4);
  }
}

function drawRocks(ctx, x, y) {
  ctx.fillStyle = "rgba(80,100,120,0.06)";
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 10, y + 4, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - 5, y + 6, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

/* ── compass rose ── */
function drawCompass(ctx, cx, cy, r) {
  ctx.save();
  ctx.fillStyle = "rgba(8,12,18,0.8)";
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(100,140,180,0.2)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.stroke();

  // N pointer
  ctx.fillStyle = "#e74c3c";
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx - 4, cy);
  ctx.lineTo(cx + 4, cy);
  ctx.closePath();
  ctx.fill();
  // S pointer
  ctx.fillStyle = "rgba(200,220,240,0.25)";
  ctx.beginPath();
  ctx.moveTo(cx, cy + r);
  ctx.lineTo(cx - 4, cy);
  ctx.lineTo(cx + 4, cy);
  ctx.closePath();
  ctx.fill();

  ctx.font = "bold 8px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillStyle = "#e74c3c";
  ctx.fillText("N", cx, cy - r - 4);
  ctx.fillStyle = "rgba(200,220,240,0.4)";
  ctx.fillText("S", cx, cy + r + 10);
  ctx.textAlign = "start";
  ctx.restore();
}

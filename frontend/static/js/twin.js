/**
 * 2D digital-twin renderer for the mine haul-road loop.
 *
 * Visual features:
 *  - Background: real aerial photograph of open-pit mine (mine_bg.jpg)
 *  - Dark vignette overlay for contrast
 *  - Routes: glowing colored lines (green/yellow/orange/red) matching reference image
 *  - Fog zones: localised animated cloud puffs (NO global white overlay)
 *  - Vehicles: yellow dump-truck body, cab, headlights, status glow ring, sensor cone
 *  - V2V: dashed blue animated lines + travelling data-packet dot
 *  - Infrastructure labels: pill badges for Loading Point, Crusher, Dumping Area, etc.
 *  - HUD: fog-status badge (top-left), live legend (bottom-right), compass (top-right)
 */
const TWIN_W = 860;
const TWIN_H = 680;

const ZONE_COLORS = {
  straight:     "#00e060",   // bright green  — safe route
  curve:        "#f1c40f",   // yellow        — caution
  intersection: "#ff7700",   // orange        — moderate risk
  loading:      "#3fa9f5",   // cyan-blue     — loading point
  dumping:      "#ff3c3c",   // red           — dumping
};

/* Route glow colours */
const ZONE_GLOW = {
  straight:     "rgba(0,220,90,0.50)",
  curve:        "rgba(240,190,0,0.50)",
  intersection: "rgba(255,120,0,0.55)",
  loading:      "rgba(63,169,245,0.50)",
  dumping:      "rgba(255,60,60,0.55)",
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

/* ── background image (preloaded once) ── */
let _bgImage     = null;
let _bgLoaded    = false;

function _loadBg() {
  if (_bgImage) return;
  _bgImage = new Image();
  _bgImage.onload  = () => { _bgLoaded = true; };
  _bgImage.onerror = () => { _bgLoaded = false; console.warn("mine_bg.jpg not found, using canvas terrain"); };
  _bgImage.src = "/static/img/mine_bg.jpg";
}

/* ── localised fog-cloud particles (spawned near fog-zone segments) ── */
let fogClouds = [];
let fogCloudsInited = false;

function initFogClouds(fogZoneSegments) {
  fogClouds = [];
  fogCloudsInited = true;
  for (const seg of fogZoneSegments) {
    const [ax, ay] = seg.a;
    const [bx, by] = seg.b;
    const count = 18;
    for (let i = 0; i < count; i++) {
      const t = Math.random();
      fogClouds.push({
        x: ax + (bx - ax) * t + (Math.random() - 0.5) * 80,
        y: ay + (by - ay) * t + (Math.random() - 0.5) * 80,
        r: 25 + Math.random() * 50,
        dx: (Math.random() - 0.5) * 0.35,
        dy: (Math.random() - 0.5) * 0.12,
        phase: Math.random() * Math.PI * 2,
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
    p.x += (p.homeX - p.x) * 0.003;
    p.y += (p.homeY - p.y) * 0.003;
  }
}

/* ── animation frame counter ── */
let _twinFrame = 0;

function initTwinCanvas(canvas) {
  canvas.width  = TWIN_W;
  canvas.height = TWIN_H;
  _loadBg();
  return canvas.getContext("2d");
}

function lerp(a, b, t) { return a + (b - a) * t; }

/* ────────────────────── MAIN DRAW ────────────────────── */
function drawTwin(ctx, state) {
  _twinFrame++;
  stepFogClouds();

  ctx.clearRect(0, 0, TWIN_W, TWIN_H);

  /* ── 1. Background: real aerial photo ── */
  if (_bgLoaded && _bgImage) {
    ctx.drawImage(_bgImage, 0, 0, TWIN_W, TWIN_H);
  } else {
    /* Fallback canvas terrain while image loads */
    const bgGrad = ctx.createRadialGradient(TWIN_W*0.5, TWIN_H*0.48, 60, TWIN_W*0.5, TWIN_H*0.48, TWIN_W*0.72);
    bgGrad.addColorStop(0,    "#1a0d06");
    bgGrad.addColorStop(0.30, "#3d2010");
    bgGrad.addColorStop(0.58, "#6b4020");
    bgGrad.addColorStop(0.80, "#1e3a10");
    bgGrad.addColorStop(1.0,  "#0e1e08");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, TWIN_W, TWIN_H);
  }

  /* ── 2. Dark overlay for contrast (keeps UI readable) ── */
  // Vignette
  const vig = ctx.createRadialGradient(TWIN_W*0.5, TWIN_H*0.5, TWIN_W*0.2, TWIN_W*0.5, TWIN_H*0.5, TWIN_W*0.8);
  vig.addColorStop(0,   "rgba(0,0,0,0)");
  vig.addColorStop(0.7, "rgba(0,0,0,0.15)");
  vig.addColorStop(1,   "rgba(0,0,0,0.65)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, TWIN_W, TWIN_H);

  /* ── 3. Infrastructure labels (under routes so roads go on top) ── */
  drawTerrainFeatures(ctx);

  const road = state.road;
  if (!road) return;
  const pts   = road.points;
  const zones = road.zones;
  const fogStatus  = state.fog ? state.fog.status    : "CLEAR";
  const visibility = state.fog ? state.fog.visibility_m : 200;

  /* ── 4. Initialise fog clouds from road data (once) ── */
  if (!fogCloudsInited) {
    const segs = [];
    for (let i = 0; i < pts.length; i++) {
      if (zones[i].is_fog_zone) {
        segs.push({ a: pts[i], b: pts[(i + 1) % pts.length] });
      }
    }
    initFogClouds(segs);
  }

  /* ── 5. Road segments — glowing colored route lines ── */
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const zone = zones[i];
    const routeColor = ZONE_COLORS[zone.type] || "#00e060";
    const routeGlow  = ZONE_GLOW[zone.type]   || "rgba(0,220,90,0.45)";

    // Wide outer glow halo
    ctx.strokeStyle = routeGlow;
    ctx.lineWidth   = 22;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();

    // Narrow bright core
    ctx.strokeStyle = routeColor;
    ctx.lineWidth   = 4;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();

    // Animated traveling white dash (gives motion on the route)
    ctx.strokeStyle   = "rgba(255,255,255,0.65)";
    ctx.lineWidth     = 1.8;
    ctx.setLineDash([7, 10]);
    ctx.lineDashOffset = -_twinFrame * 0.55;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // Fog-zone pulsing blue aura (localised, not global)
    if (zone.is_fog_zone) {
      const base  = { CLEAR: 0.02, LIGHT: 0.10, MEDIUM: 0.20, HEAVY: 0.34, EXTREME: 0.50 }[fogStatus] || 0.03;
      const pulse = Math.sin(_twinFrame * 0.035) * 0.07;
      ctx.strokeStyle = `rgba(180,215,255,${Math.max(0, base + pulse)})`;
      ctx.lineWidth   = 32;
      ctx.lineCap     = "round";
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  }

  /* ── 6. Zone labels ── */
  const labeled = new Set();
  for (let i = 0; i < pts.length; i++) {
    const zone = zones[i];
    if (["loading","dumping","curve","intersection"].includes(zone.type) && !labeled.has(zone.type)) {
      labeled.add(zone.type);
      const p        = pts[i];
      const icon     = ZONE_ICONS[zone.type] || "";
      const txt      = `${icon} ${zone.name.toUpperCase()}`;
      ctx.font       = "bold 11px Segoe UI";
      const tw       = ctx.measureText(txt).width;
      const lx = p[0] - tw/2 - 7;
      const ly = p[1] - 34;
      ctx.fillStyle = "rgba(8,14,22,0.82)";
      ctx.beginPath();
      ctx.roundRect(lx, ly, tw + 14, 20, 5);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth   = 0.6;
      ctx.beginPath();
      ctx.roundRect(lx, ly, tw + 14, 20, 5);
      ctx.stroke();
      ctx.fillStyle = "#d8ecf8";
      ctx.fillText(txt, lx + 7, ly + 14);
    }
  }

  /* ── 7. V2V communication lines ── */
  const msgs = state.v2v_messages || [];
  msgs.forEach((m) => {
    const s = state.vehicles[m.sender];
    const r = state.vehicles[m.receiver];
    if (!s || !r) return;

    const t = (_twinFrame * 0.06) % 1;

    // Glow underlay
    ctx.strokeStyle = `rgba(63,169,245,${0.12 + Math.sin(t * Math.PI * 2) * 0.08})`;
    ctx.lineWidth   = 3;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(r.x, r.y);
    ctx.stroke();

    // Animated dashes — blue
    ctx.strokeStyle   = "rgba(63,200,255,0.7)";
    ctx.lineWidth     = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.lineDashOffset = -_twinFrame * 0.8;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(r.x, r.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // V2V label midpoint
    const mx = lerp(s.x, r.x, 0.5);
    const my = lerp(s.y, r.y, 0.5);
    ctx.fillStyle = "rgba(8,14,22,0.75)";
    ctx.beginPath();
    ctx.roundRect(mx - 15, my - 9, 30, 15, 4);
    ctx.fill();
    ctx.fillStyle = "#3fc8ff";
    ctx.font      = "bold 9px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText("V2V", mx, my + 3);
    ctx.textAlign = "start";

    // Travelling packet dot
    const px = lerp(s.x, r.x, t);
    const py = lerp(s.y, r.y, t);
    ctx.fillStyle = "#3fa9f5";
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(63,169,245,0.3)";
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fill();
  });

  /* ── 8. Vehicles — yellow dump-truck style ── */
  Object.values(state.vehicles || {}).forEach((v) => {
    const hazardColor = VEHICLE_COLORS[v.hazard_status] || "#2ecc71";

    /* — Green / status glow ring (large) — matches reference image green circles */
    ctx.save();
    ctx.translate(v.x, v.y);
    const glowOuter = ctx.createRadialGradient(0, 0, 12, 0, 0, 38);
    glowOuter.addColorStop(0,   hazardColor + "55");
    glowOuter.addColorStop(0.6, hazardColor + "22");
    glowOuter.addColorStop(1,   "rgba(0,0,0,0)");
    ctx.fillStyle = glowOuter;
    ctx.beginPath();
    ctx.arc(0, 0, 38, 0, Math.PI * 2);
    ctx.fill();

    // Pulsing ring (outer circle like in reference)
    const ringPulse = 26 + Math.sin(_twinFrame * 0.1) * 4;
    ctx.strokeStyle = hazardColor + "aa";
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(0, 0, ringPulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Sensor forward cone
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate((v.heading_deg * Math.PI) / 180);
    const sensorRange = Math.min(visibility * 0.35, 60);
    ctx.fillStyle = v.hazard_status === "RED"
      ? `rgba(231,76,60,0.12)` : `rgba(63,200,255,0.07)`;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, sensorRange, -Math.PI * 0.28, Math.PI * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Truck body (yellow — matches reference HEMM dump trucks)
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate((v.heading_deg * Math.PI) / 180);

    // Dump bed (large rectangle)
    ctx.fillStyle = "#e8b800";
    ctx.beginPath();
    ctx.roundRect(-12, -7, 22, 14, 3);
    ctx.fill();

    // Cab (front wedge, slightly brighter)
    ctx.fillStyle = "#ffd020";
    ctx.beginPath();
    ctx.moveTo(10, -5);
    ctx.lineTo(16, 0);
    ctx.lineTo(10, 5);
    ctx.closePath();
    ctx.fill();

    // Wheels (dark dots)
    ctx.fillStyle = "#1a1a1a";
    [[-8,-7],[0,-7],[8,-7],[-8,7],[0,7],[8,7]].forEach(([wx,wy]) => {
      ctx.beginPath();
      ctx.arc(wx, wy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // Headlights
    ctx.fillStyle = "#fffde0";
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(15, -2.5, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(15,  2.5, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;

    // Status ring (tight inner)
    ctx.strokeStyle = hazardColor;
    ctx.lineWidth   = 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.stroke();

    // RED critical — pulsing outer ring
    if (v.hazard_status === "RED") {
      const pr = 20 + Math.sin(_twinFrame * 0.14) * 5;
      ctx.strokeStyle = `rgba(231,76,60,${0.3 + Math.sin(_twinFrame * 0.14) * 0.2})`;
      ctx.lineWidth   = 1.5;
      ctx.shadowColor = "#e74c3c";
      ctx.shadowBlur  = 10;
      ctx.beginPath();
      ctx.arc(0, 0, pr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // Vehicle ID label
    const idLabelX = v.x - 22;
    const idLabelY = v.y - 26;
    ctx.fillStyle = "rgba(8,14,22,0.82)";
    ctx.beginPath();
    ctx.roundRect(idLabelX - 2, idLabelY - 12, 48, 14, 3);
    ctx.fill();
    ctx.fillStyle = "#f0f8ff";
    ctx.font      = "bold 10px Segoe UI";
    ctx.fillText(v.id, idLabelX, idLabelY);

    // Speed label below
    const spd  = `${v.speed_kmh} km/h`;
    const sw   = ctx.measureText(spd).width;
    ctx.fillStyle = "rgba(8,14,22,0.72)";
    ctx.beginPath();
    ctx.roundRect(v.x - sw/2 - 4, v.y + 22, sw + 8, 14, 3);
    ctx.fill();
    ctx.fillStyle = hazardColor;
    ctx.font      = "bold 10px Segoe UI";
    ctx.fillText(spd, v.x - sw/2, v.y + 33);
  });

  /* ── 9. Localised fog clouds near fog zones ── */
  const fogAlphaMap = { CLEAR: 0, LIGHT: 0.10, MEDIUM: 0.22, HEAVY: 0.40, EXTREME: 0.60 };
  const fogAlpha = fogAlphaMap[fogStatus] || 0;
  if (fogAlpha > 0.01) {
    for (const p of fogClouds) {
      const breathe = 0.5 + 0.5 * Math.sin(p.phase);
      const a = fogAlpha * breathe * 0.22;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0,   `rgba(210,225,240,${a})`);
      g.addColorStop(0.55,`rgba(200,215,235,${a * 0.4})`);
      g.addColorStop(1,   "rgba(200,215,235,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ── 10. HUD: fog badge (top-left) ── */
  const badgeColors = {
    CLEAR: "#2ecc71", LIGHT: "#9be15d", MEDIUM: "#f1c40f",
    HEAVY: "#e67e22", EXTREME: "#e74c3c",
  };
  const bc  = badgeColors[fogStatus] || "#2ecc71";
  const bt  = `FOG: ${fogStatus}  ·  ${visibility} m`;
  ctx.font  = "bold 11px Segoe UI";
  const btw = ctx.measureText(bt).width;
  ctx.fillStyle = "rgba(6,10,18,0.88)";
  ctx.beginPath();
  ctx.roundRect(10, 10, btw + 32, 28, 6);
  ctx.fill();
  ctx.strokeStyle = bc + "55";
  ctx.lineWidth   = 0.8;
  ctx.beginPath();
  ctx.roundRect(10, 10, btw + 32, 28, 6);
  ctx.stroke();
  ctx.fillStyle = bc;
  ctx.beginPath();
  ctx.arc(25, 24, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ddeeff";
  ctx.fillText(bt, 36, 29);

  /* ── 11. HUD: compass (top-right) ── */
  drawCompass(ctx, TWIN_W - 42, 42, 24);

  /* ── 12. HUD: Route Status legend (bottom-right) ── */
  const lx = TWIN_W - 155;
  const ly = TWIN_H - 106;
  ctx.fillStyle = "rgba(6,10,18,0.86)";
  ctx.beginPath();
  ctx.roundRect(lx, ly, 145, 96, 7);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth   = 0.6;
  ctx.beginPath();
  ctx.roundRect(lx, ly, 145, 96, 7);
  ctx.stroke();
  ctx.font      = "bold 9px Segoe UI";
  ctx.fillStyle = "#6088a0";
  ctx.fillText("ROUTE STATUS", lx + 8, ly + 14);
  const routeLegend = [
    { c: "#00e060", l: "Safe" },
    { c: "#f1c40f", l: "Caution" },
    { c: "#ff7700", l: "High Risk" },
    { c: "#ff3c3c", l: "Critical" },
  ];
  ctx.font = "10px Segoe UI";
  routeLegend.forEach((it, i) => {
    const iy = ly + 28 + i * 16;
    // colored dash line (matches route style)
    ctx.strokeStyle = it.c;
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.moveTo(lx + 8, iy);
    ctx.lineTo(lx + 24, iy);
    ctx.stroke();
    ctx.fillStyle = "#b8ccd8";
    ctx.fillText(it.l, lx + 28, iy + 4);
  });

  /* ── 13. Situational Awareness Overlay (demo blind-curve scenario) ── */
  drawSituationalOverlay(ctx);
}

/* ══════════════════════════════════════════════════════════════
   SITUATIONAL AWARENESS OVERLAY
   Reads from window._fognetOverlay (set by demo state machine).
   Shows:
   - DUMPER-01: large danger safety bubble (approaching blind curve)
   - DUMPER-02: ghost "hidden vehicle" beyond blind curve
   - Animated V2V pulse line between them
   - ⚠ HIDDEN VEHICLE DETECTED warning card
══════════════════════════════════════════════════════════════ */
function drawSituationalOverlay(ctx) {
  const ov = window._fognetOverlay;
  if (!ov || !ov.active) return;

  const D01 = { x: 210, y: 310 };   // DUMPER-01 approaching blind curve
  const D02 = { x: 138, y: 195 };   // DUMPER-02 hidden beyond curve

  const riskColors = {
    MONITORING: "#6088a0", LOW: "#9be15d", MEDIUM: "#f1c40f",
    HIGH: "#e74c3c",        SAFE: "#2ecc71",
  };
  const col = riskColors[ov.riskLevel] || "#6088a0";

  /* ── DUMPER-01: expanding safety bubble ── */
  const bubbleR = 48 + Math.sin(_twinFrame * 0.08) * 6;
  ctx.save();
  const halo = ctx.createRadialGradient(D01.x, D01.y, 8, D01.x, D01.y, bubbleR + 14);
  halo.addColorStop(0,   col + "55");
  halo.addColorStop(0.6, col + "18");
  halo.addColorStop(1,   "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(D01.x, D01.y, bubbleR + 14, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = col;
  ctx.lineWidth   = ov.riskLevel === "HIGH" ? 2.5 : 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.arc(D01.x, D01.y, bubbleR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Visual range arc (very short — 8 m visibility)
  ctx.strokeStyle = "rgba(231,76,60,0.5)";
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.arc(D01.x, D01.y, 20, -Math.PI * 0.6, -Math.PI * 0.05);
  ctx.stroke();

  ctx.fillStyle = "rgba(6,10,18,0.85)";
  ctx.beginPath();
  ctx.roundRect(D01.x - 44, D01.y - 54, 86, 18, 4);
  ctx.fill();
  ctx.fillStyle = col;
  ctx.font      = "bold 10px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText("DUMPER-01  ← YOU", D01.x - 1, D01.y - 41);
  ctx.textAlign = "start";
  ctx.restore();

  /* ── V2V animated pulse line ── */
  if (ov.v2vPulse) {
    const t = (_twinFrame * 0.05) % 1;

    ctx.save();
    ctx.strokeStyle = "rgba(63,200,255,0.18)";
    ctx.lineWidth   = 5;
    ctx.beginPath();
    ctx.moveTo(D01.x, D01.y);
    ctx.lineTo(D02.x, D02.y);
    ctx.stroke();

    ctx.strokeStyle   = "rgba(63,200,255,0.75)";
    ctx.lineWidth     = 1.8;
    ctx.setLineDash([5, 7]);
    ctx.lineDashOffset = -_twinFrame * 0.9;
    ctx.beginPath();
    ctx.moveTo(D01.x, D01.y);
    ctx.lineTo(D02.x, D02.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // Travelling packet dot
    const px = D01.x + (D02.x - D01.x) * t;
    const py = D01.y + (D02.y - D01.y) * t;
    ctx.fillStyle = "#3ff0ff";
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(63,240,255,0.25)";
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fill();

    const mx = (D01.x + D02.x) / 2;
    const my = (D01.y + D02.y) / 2;
    ctx.fillStyle = "rgba(6,10,18,0.82)";
    ctx.beginPath();
    ctx.roundRect(mx - 18, my - 10, 36, 17, 4);
    ctx.fill();
    ctx.fillStyle = "#3ff0ff";
    ctx.font      = "bold 9px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText("V2V", mx, my + 3);
    ctx.textAlign = "start";
    ctx.restore();
  }

  /* ── DUMPER-02: ghost / hidden vehicle ── */
  if (ov.hiddenVehicle) {
    ctx.save();
    ctx.globalAlpha = 0.38 + Math.sin(_twinFrame * 0.07) * 0.12;

    const ghostGlow = ctx.createRadialGradient(D02.x, D02.y, 4, D02.x, D02.y, 36);
    ghostGlow.addColorStop(0,   "rgba(231,76,60,0.55)");
    ghostGlow.addColorStop(0.6, "rgba(231,76,60,0.15)");
    ghostGlow.addColorStop(1,   "rgba(0,0,0,0)");
    ctx.fillStyle = ghostGlow;
    ctx.beginPath();
    ctx.arc(D02.x, D02.y, 36, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(231,76,60,0.7)";
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.roundRect(D02.x - 10, D02.y - 6, 20, 12, 3);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(230,180,0,0.45)";
    ctx.beginPath();
    ctx.roundRect(D02.x - 10, D02.y - 6, 20, 12, 3);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    ctx.strokeStyle = "rgba(63,200,255,0.55)";
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(D02.x, D02.y, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(6,10,18,0.88)";
    ctx.beginPath();
    ctx.roundRect(D02.x - 50, D02.y - 46, 100, 18, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(231,76,60,0.95)";
    ctx.font      = "bold 10px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText("DUMPER-02 ← HIDDEN", D02.x, D02.y - 33);
    ctx.textAlign = "start";
    ctx.restore();
  }

  /* ── WARNING CARD: ⚠ HIDDEN VEHICLE DETECTED ── */
  if (ov.hiddenVehicle && ov.ttc !== null) {
    const cx = 14, cy = TWIN_H - 160, cw = 215, ch = 92;
    const pulse = 0.7 + Math.sin(_twinFrame * 0.12) * 0.3;

    ctx.save();
    ctx.fillStyle = "rgba(6,8,14,0.92)";
    ctx.beginPath();
    ctx.roundRect(cx, cy, cw, ch, 8);
    ctx.fill();
    ctx.strokeStyle = `rgba(231,76,60,${pulse})`;
    ctx.lineWidth   = 1.8;
    ctx.beginPath();
    ctx.roundRect(cx, cy, cw, ch, 8);
    ctx.stroke();

    ctx.fillStyle = "#e74c3c";
    ctx.font      = "bold 11px Segoe UI";
    ctx.fillText("⚠  HIDDEN VEHICLE DETECTED", cx + 10, cy + 20);

    ctx.strokeStyle = "rgba(231,76,60,0.22)";
    ctx.lineWidth   = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx + 10, cy + 28); ctx.lineTo(cx + cw - 10, cy + 28);
    ctx.stroke();

    ctx.font      = "10px Segoe UI";
    ctx.fillStyle = "#8aabbc";
    ctx.fillText("Vehicle",  cx + 10, cy + 44);
    ctx.fillText("Distance", cx + 10, cy + 59);
    ctx.fillText("TTC",      cx + 10, cy + 74);

    ctx.font      = "bold 11px Segoe UI";
    ctx.fillStyle = "#f0f8ff";
    ctx.fillText("DUMPER-02", cx + 95, cy + 44);
    ctx.fillText(`${ov.gap || 42} m`, cx + 95, cy + 59);

    const ttcCol = ov.riskLevel === "HIGH" ? "#e74c3c" : ov.riskLevel === "MEDIUM" ? "#f1c40f" : "#2ecc71";
    ctx.fillStyle = ttcCol;
    ctx.fillText(`${ov.ttc} s`, cx + 95, cy + 74);
    ctx.restore();
  }

  /* ── SAFE outcome overlay ── */
  if (ov.riskLevel === "SAFE" && ov.actionTaken) {
    ctx.save();
    ctx.fillStyle = "rgba(6,14,10,0.90)";
    ctx.beginPath();
    ctx.roundRect(14, TWIN_H - 168, 200, 50, 7);
    ctx.fill();
    ctx.strokeStyle = "rgba(46,204,113,0.8)";
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.roundRect(14, TWIN_H - 168, 200, 50, 7);
    ctx.stroke();
    ctx.font      = "bold 13px Segoe UI";
    ctx.fillStyle = "#2ecc71";
    ctx.fillText("✓  RISK RESOLVED", 26, TWIN_H - 148);
    ctx.font      = "10px Segoe UI";
    ctx.fillStyle = "#7fc8a0";
    ctx.fillText("FOGNET: safe passage confirmed", 26, TWIN_H - 130);
    ctx.restore();
  }
}

/* ── Infrastructure labels ── */
function drawTerrainFeatures(ctx) {
  drawTower(ctx, 58,  72);
  drawTower(ctx, TWIN_W - 75, TWIN_H - 92);
  drawTower(ctx, TWIN_W - 88, 98);

  drawInfraLabel(ctx, 52,  40,  "📍", "Loading Point (LP-1)", "#3fa9f5");
  drawInfraLabel(ctx, TWIN_W - 106, 40, "🏭", "Crusher",            "#b0c8e0");
  drawInfraLabel(ctx, TWIN_W - 122, TWIN_H - 52, "📦", "Dumping Area",     "#e67e22");
  drawInfraLabel(ctx, 38,  TWIN_H - 52, "🗺", "East Ridge",         "#8aaa80");
  drawInfraLabel(ctx, TWIN_W*0.5 - 52, TWIN_H*0.52 + 60, "⛰", "Hilltop Sector", "#c0a860");
  drawInfraLabel(ctx, TWIN_W*0.62, TWIN_H*0.28, "✦", "Intersection",     "#ffcc44");
}

function drawInfraLabel(ctx, x, y, icon, text, color) {
  ctx.font      = "bold 10px Segoe UI";
  const tw      = ctx.measureText(text).width;
  const pw      = tw + 28;
  ctx.fillStyle = "rgba(6,10,18,0.80)";
  ctx.beginPath();
  ctx.roundRect(x, y, pw, 22, 5);
  ctx.fill();
  ctx.strokeStyle = color + "55";
  ctx.lineWidth   = 0.8;
  ctx.beginPath();
  ctx.roundRect(x, y, pw, 22, 5);
  ctx.stroke();
  // dot
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + 8, y + 11, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#cce0f0";
  ctx.fillText(text, x + 16, y + 15);
}

function drawTower(ctx, x, y) {
  ctx.strokeStyle = "rgba(160,200,240,0.25)";
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 32);
  ctx.stroke();
  [[y-24, 8],[y-14, 5]].forEach(([cy, hw]) => {
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x - hw, cy); ctx.lineTo(x + hw, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - hw, cy); ctx.lineTo(x, cy + 9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + hw, cy); ctx.lineTo(x, cy + 9); ctx.stroke();
  });
  const blink = Math.sin(_twinFrame * 0.09) > 0;
  ctx.fillStyle   = blink ? "rgba(231,76,60,0.85)" : "rgba(231,76,60,0.15)";
  ctx.shadowColor = blink ? "#e74c3c" : "transparent";
  ctx.shadowBlur  = blink ? 10 : 0;
  ctx.beginPath();
  ctx.arc(x, y - 32, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

/* ── Compass rose ── */
function drawCompass(ctx, cx, cy, r) {
  ctx.save();
  ctx.fillStyle = "rgba(6,10,18,0.82)";
  ctx.beginPath();
  ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth   = 0.6;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
  ctx.stroke();

  // N pointer (red)
  ctx.fillStyle = "#e74c3c";
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx - 5, cy);
  ctx.lineTo(cx + 5, cy);
  ctx.closePath();
  ctx.fill();
  // S pointer (grey)
  ctx.fillStyle = "rgba(200,220,240,0.28)";
  ctx.beginPath();
  ctx.moveTo(cx, cy + r);
  ctx.lineTo(cx - 5, cy);
  ctx.lineTo(cx + 5, cy);
  ctx.closePath();
  ctx.fill();

  ctx.font      = "bold 9px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillStyle = "#e74c3c";
  ctx.fillText("N", cx, cy - r - 5);
  ctx.fillStyle = "rgba(200,220,240,0.45)";
  ctx.fillText("S", cx, cy + r + 11);
  ctx.textAlign = "start";
  ctx.restore();
}

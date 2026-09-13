/**
 * control_room.js
 * Drives the FOGNET Control Centre:
 *   - WebSocket state rendering
 *   - Visibility gauge
 *   - RISK → ACTION panel with live demo state machine
 *   - 12-step demo scenario (blind curve / hidden vehicle / TTC / resolution)
 */

/* ── canvas setup ── */
const canvas = document.getElementById("twin-canvas");
const ctx    = initTwinCanvas(canvas);

const connDot  = document.getElementById("conn-dot");
const connText = document.getElementById("conn-text");

/* ═══════════════════════════════════════════════════════════
   DEMO STATE MACHINE
   12 steps that play automatically when DEMO MODE is active.
   Each step mutates _demoState which drives the right panel
   and the map overlay in twin.js.
═══════════════════════════════════════════════════════════ */
const _demoState = {
  active:         false,
  step:           0,
  stepStartedAt:  0,
  visVisual:      200,   // driver's eye visibility
  visVirtual:     200,   // FOGNET virtual visibility (via sensor fusion)
  riskLevel:      "MONITORING",
  ttc:            null,
  speed:          22,
  recommendedSpeed: 22,
  whyReasons:     ["All vehicles clear", "Normal visibility"],
  recommendAction:"— NORMAL OPERATIONS —",
  predNoAction:   null,
  predAction:     null,
  showApply:      false,
  actionTaken:    false,
  outcome:        null,
  showForecast:   false,
  // Map overlay data (read by twin.js via window._fognetOverlay)
  overlay: {
    active:           false,
    d01x: 0, d01y: 0,
    d02x: 0, d02y: 0,
    ttc:              null,
    gap:              null,
    riskLevel:        "MONITORING",
    v2vPulse:         false,
    hiddenVehicle:    false,
    actionTaken:      false,
  },
};

/* Expose overlay to twin.js */
window._fognetOverlay = _demoState.overlay;

/* Step durations in ms */
const STEP_DUR = 2500;

const DEMO_STEPS = [
  // 0: baseline
  {
    vis: 200, visV: 400, risk: "MONITORING", ttc: null, speed: 22, recSpeed: 22,
    why: ["Normal visibility","All vehicles clear","V2V active"],
    rec: "— NORMAL OPERATIONS —", predNo: null, predYes: null,
    showApply: false, overlay: { active: false },
  },
  // 1: fog starts
  {
    vis: 50, visV: 300, risk: "MONITORING", ttc: null, speed: 22, recSpeed: 22,
    why: ["Fog forming — 50 m","V2V active","Monitoring DUMPER-01 route"],
    rec: "⚠ Monitor curve approach",predNo: null, predYes: null,
    showApply: false, overlay: { active: false },
  },
  // 2: fog heavier
  {
    vis: 20, visV: 200, risk: "LOW", ttc: null, speed: 22, recSpeed: 20,
    why: ["Visibility: 20 m","Blind curve ahead","DUMPER-02 beyond curve"],
    rec: "↓ Reduce speed to 20 km/h", predNo: null, predYes: null,
    showApply: false, overlay: { active: true, hiddenVehicle: false, v2vPulse: false },
  },
  // 3: dense fog, DUMPER-02 hidden
  {
    vis: 8, visV: 75, risk: "MEDIUM", ttc: 6.2, speed: 22, recSpeed: 16,
    why: ["Visibility: 8 m","Blind curve — DUMPER-02 hidden","FOGNET V2V detects DUMPER-02","Closing speed: 7.2 m/s"],
    rec: "↓ Reduce speed to 16 km/h",
    predNo: "If no action: TTC 6.2 s → 4.1 s → CRITICAL",
    predYes: "If action taken: TTC 6.2 s → 8.0 s → SAFE",
    showApply: true,
    overlay: { active: true, hiddenVehicle: true, v2vPulse: true, gap: 55, ttc: 6.2, riskLevel: "MEDIUM" },
  },
  // 4: TTC decreasing
  {
    vis: 8, visV: 75, risk: "HIGH", ttc: 4.8, speed: 22, recSpeed: 12,
    why: ["Visibility: 8 m","Blind curve","DUMPER-02 closing — 42 m","Relative speed: 7.2 m/s"],
    rec: "↓ REDUCE SPEED TO 12 km/h",
    predNo: "If no action: TTC 4.8 s → 3.1 s → CRITICAL",
    predYes: "If action taken: TTC 4.8 s → 6.2 s → SAFE",
    showApply: true,
    overlay: { active: true, hiddenVehicle: true, v2vPulse: true, gap: 42, ttc: 4.8, riskLevel: "HIGH" },
  },
  // 5: critical threshold
  {
    vis: 8, visV: 75, risk: "HIGH", ttc: 4.1, speed: 22, recSpeed: 12,
    why: ["Visibility: 8 m","DUMPER-02 — 38 m","TTC CRITICAL","FOGNET: BRAKE COMMAND"],
    rec: "🛑 REDUCE SPEED TO 12 km/h — IMMEDIATE",
    predNo: "If no action: COLLISION in 4.1 s",
    predYes: "APPLY NOW → TTC will recover",
    showApply: true,
    overlay: { active: true, hiddenVehicle: true, v2vPulse: true, gap: 38, ttc: 4.1, riskLevel: "HIGH" },
  },
  // 6: action applied — speed starts dropping
  {
    vis: 8, visV: 75, risk: "MEDIUM", ttc: 5.0, speed: 18, recSpeed: 12,
    why: ["Speed reducing: 22 → 18 km/h","FOGNET command applied","Monitoring TTC recovery"],
    rec: "Slowing to 12 km/h...",
    predNo: null, predYes: "TTC recovering → 5.0 s",
    showApply: false, actionTaken: true,
    outcome: { speed: "18 km/h", result: "Slowing..." },
    overlay: { active: true, hiddenVehicle: true, v2vPulse: true, gap: 42, ttc: 5.0, riskLevel: "MEDIUM", actionTaken: true },
  },
  // 7: speed at 12, TTC recovering
  {
    vis: 8, visV: 75, risk: "LOW", ttc: 6.2, speed: 12, recSpeed: 12,
    why: ["Speed: 12 km/h — target reached","TTC recovering","DUMPER-02 visible to FOGNET"],
    rec: "✓ Maintain 12 km/h through curve",
    predNo: null, predYes: "TTC 6.2 s — improving",
    showApply: false, actionTaken: true,
    outcome: { speed: "12 km/h", result: "TTC recovering ↑" },
    overlay: { active: true, hiddenVehicle: false, v2vPulse: true, gap: 52, ttc: 6.2, riskLevel: "LOW", actionTaken: true },
  },
  // 8: SAFE
  {
    vis: 8, visV: 75, risk: "SAFE", ttc: 8.5, speed: 12, recSpeed: 12,
    why: ["Speed: 12 km/h","TTC: 8.5 s — safe margin","Cooperative perception maintained"],
    rec: "✓ RISK RESOLVED — Safe passage",
    predNo: null, predYes: null,
    showApply: false, actionTaken: true,
    outcome: { speed: "12 km/h", result: "✓ SAFE" },
    overlay: { active: true, hiddenVehicle: false, v2vPulse: true, gap: 62, ttc: 8.5, riskLevel: "SAFE", actionTaken: true },
  },
  // 9: Fog forecast + AI recommendation
  {
    vis: 8, visV: 75, risk: "SAFE", ttc: 8.5, speed: 12, recSpeed: 12,
    why: ["Fog forecast: < 5 m in 10 min","AI routing analysis complete"],
    rec: "AI FLEET RECOMMENDATION READY",
    predNo: null, predYes: null,
    showApply: false, showForecast: true,
    overlay: { active: true, hiddenVehicle: false, v2vPulse: false, gap: 65, ttc: 8.5, riskLevel: "SAFE", actionTaken: true },
  },
];

let _demoStepIndex = 0;
let _demoTimer = null;
let _demoRunning = false;
let _actionApplied = false;

function startDemoSequence() {
  _demoRunning   = true;
  _actionApplied = false;
  _demoStepIndex = 0;
  applyDemoStep(0);
}

function stopDemoSequence() {
  _demoRunning = false;
  clearTimeout(_demoTimer);
  applyDemoStep(0); // reset to baseline
}

function applyDemoStep(idx) {
  if (idx >= DEMO_STEPS.length) {
    _demoRunning = false;
    return;
  }
  _demoStepIndex = idx;
  const step = DEMO_STEPS[idx];

  // Update visibility readouts
  document.getElementById("vis-visual").textContent  = step.vis  + " m";
  document.getElementById("vis-virtual").textContent = step.visV + " m";

  // Apply colour to virtual readout
  const virtEl = document.getElementById("vis-virtual");
  virtEl.className = "vis-dual-val fognet-val";
  const visEl  = document.getElementById("vis-visual");
  visEl.style.color = step.vis < 20 ? "#e74c3c" : step.vis < 60 ? "#e67e22" : "#2ecc71";

  // Update risk panel
  updateRiskPanel(step);

  // Update map overlay
  Object.assign(window._fognetOverlay, { active: false, hiddenVehicle: false, v2vPulse: false, actionTaken: false });
  if (step.overlay) Object.assign(window._fognetOverlay, step.overlay);

  // Forecast panel
  const fpanel = document.getElementById("fog-forecast-panel");
  if (step.showForecast) fpanel.style.display = "block";

  // Draw gauge
  drawVisGauge(step.vis, step.vis < 30 ? "EXTREME" : step.vis < 60 ? "HEAVY" : step.vis < 100 ? "MEDIUM" : step.vis < 150 ? "LIGHT" : "CLEAR");

  // Schedule next step (unless waiting for user action at HIGH risk)
  if (_demoRunning && idx < DEMO_STEPS.length - 1) {
    const waitForAction = step.showApply && step.risk === "HIGH" && !_actionApplied;
    if (!waitForAction) {
      _demoTimer = setTimeout(() => applyDemoStep(idx + 1), STEP_DUR);
    }
  }
}

function updateRiskPanel(step) {
  const riskColors = {
    MONITORING: "#6088a0", LOW: "#9be15d", MEDIUM: "#f1c40f",
    HIGH: "#e74c3c", SAFE: "#2ecc71",
  };
  const col = riskColors[step.risk] || "#6088a0";

  // Header
  const header = document.getElementById("ra-risk-header");
  header.style.borderColor = col;
  header.style.background  = col + "15";
  document.getElementById("ra-risk-level").textContent = step.risk;
  document.getElementById("ra-risk-level").style.color = col;
  document.getElementById("ra-ttc").textContent = step.ttc ? `TTC: ${step.ttc} s` : "TTC: — s";
  document.getElementById("ra-ttc").style.color = col;

  // Flash panel on HIGH
  const panel = document.getElementById("risk-action-panel");
  panel.className = step.risk === "HIGH"
    ? "panel risk-action-panel risk-high-pulse"
    : "panel risk-action-panel";

  // WHY list
  const list = document.getElementById("ra-why-list");
  list.innerHTML = (step.why || []).map(r => `<li>${r}</li>`).join("");

  // Recommendation
  document.getElementById("ra-recommend-action").textContent  = step.recommendAction || step.rec || "—";
  document.getElementById("ra-recommend-action").style.color  = col;

  // Prediction rows
  const predNo  = document.getElementById("ra-pred-no-action");
  const predYes = document.getElementById("ra-pred-action");
  predNo.textContent  = step.predNo  || "";
  predYes.textContent = step.predYes || "";
  predNo.style.display  = step.predNo  ? "block" : "none";
  predYes.style.display = step.predYes ? "block" : "none";

  // Apply button
  const applyBtn = document.getElementById("ra-apply-btn");
  applyBtn.style.display = (step.showApply && !_actionApplied) ? "block" : "none";

  // Outcome
  const outcomeEl = document.getElementById("ra-outcome");
  if (step.outcome) {
    outcomeEl.style.display = "flex";
    document.getElementById("ra-outcome-speed").textContent  = step.outcome.speed;
    document.getElementById("ra-outcome-result").textContent = step.outcome.result;
    document.getElementById("ra-outcome-result").style.color = col;
  } else {
    outcomeEl.style.display = "none";
  }
}

/* Apply / Simulate button click */
document.getElementById("ra-apply-btn").addEventListener("click", () => {
  _actionApplied = true;
  document.getElementById("ra-apply-btn").style.display = "none";

  // Animate speed: 22 → 18 → 12
  const steps = [
    { label: "22 km/h → 18 km/h", delay: 0 },
    { label: "18 km/h → 12 km/h", delay: 900 },
    { label: "✓ 12 km/h reached", delay: 1800 },
  ];
  const speedEl  = document.getElementById("ra-outcome-speed");
  const resultEl = document.getElementById("ra-outcome-result");
  document.getElementById("ra-outcome").style.display = "flex";
  steps.forEach(({ label, delay }) => {
    setTimeout(() => { speedEl.textContent = label; }, delay);
  });
  setTimeout(() => {
    resultEl.textContent = "TTC improving ↑";
    resultEl.style.color = "#2ecc71";
  }, 2000);

  // Advance demo from step 6 onward
  clearTimeout(_demoTimer);
  setTimeout(() => { applyDemoStep(6); }, 2200);
});

/* ═══════════════════════════════════════════════════════════
   VISIBILITY GAUGE (small, horizontal bar)
═══════════════════════════════════════════════════════════ */
function drawVisGauge(visibility, fogStatus) {
  const c = document.getElementById("vis-gauge-canvas");
  if (!c) return;
  const g  = c.getContext("2d");
  const W  = c.width;
  const H  = c.height;
  g.clearRect(0, 0, W, H);

  const MAX = 200;
  const pct = Math.min(visibility / MAX, 1);
  const barW = W - 24;
  const barH = 14;
  const bx   = 12;
  const by   = H / 2 - barH / 2;

  // Track
  g.fillStyle = "rgba(255,255,255,0.06)";
  g.beginPath();
  g.roundRect(bx, by, barW, barH, 7);
  g.fill();

  // Zones
  const zones = [
    { to: 0.15, c: "#e74c3c" },
    { to: 0.30, c: "#e67e22" },
    { to: 0.50, c: "#f1c40f" },
    { to: 0.75, c: "#9be15d" },
    { to: 1.00, c: "#2ecc71" },
  ];
  let prev = 0;
  zones.forEach(z => {
    g.fillStyle = z.c + "44";
    g.beginPath();
    g.roundRect(bx + prev * barW, by, (z.to - prev) * barW, barH, 0);
    g.fill();
    prev = z.to;
  });

  // Active fill
  let activeCol = "#2ecc71";
  if (visibility < 30)  activeCol = "#e74c3c";
  else if (visibility < 60)  activeCol = "#e67e22";
  else if (visibility < 100) activeCol = "#f1c40f";
  else if (visibility < 150) activeCol = "#9be15d";

  g.fillStyle = activeCol;
  g.beginPath();
  g.roundRect(bx, by, pct * barW, barH, 7);
  g.fill();

  // Needle
  const nx = bx + pct * barW;
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(nx, by + barH / 2, 5, 0, Math.PI * 2);
  g.fill();

  // Labels
  g.textAlign = "center";
  g.font = "9px Segoe UI";
  g.fillStyle = "rgba(200,220,240,0.5)";
  ["0", "50", "100", "150", "200"].forEach((lbl, i) => {
    g.fillText(lbl, bx + (i * 0.25) * barW, by + barH + 14);
  });
  // Value
  g.font = "bold 11px Segoe UI";
  g.fillStyle = activeCol;
  g.fillText(visibility + " m", bx + pct * barW, by - 6);
  g.textAlign = "start";
}

/* ═══════════════════════════════════════════════════════════
   WEBSOCKET STATE RENDERING
═══════════════════════════════════════════════════════════ */
function render(state) {
  drawTwin(ctx, state);
  renderVehicleTable(state);
  renderFusion(state);
  renderV2VLog(state);

  // If demo is NOT running, show live fog data in gauge
  if (!_demoRunning) {
    drawVisGauge(state.fog.visibility_m, state.fog.status);
    document.getElementById("vis-visual").textContent  = state.fog.visibility_m + " m";
    document.getElementById("vis-virtual").textContent = (state.fog.visibility_m * 2) + " m";
  }

  document.getElementById("tick-info").textContent =
    `tick ${state.tick} · ${new Date(state.timestamp * 1000).toLocaleTimeString()}`;

  const autoBtn = document.getElementById("fog-auto-btn");
  autoBtn.textContent = `Auto-Deteriorate: ${state.fog.auto_mode ? "ON" : "OFF"}`;
}

function renderVehicleTable(state) {
  const tbody = document.getElementById("vehicle-rows");
  tbody.innerHTML = "";
  Object.values(state.vehicles).forEach((v) => {
    const rec = state.recommended_speed[v.id];
    const tr  = document.createElement("tr");
    tr.innerHTML = `
      <td>${v.id}</td>
      <td>${v.speed_kmh} km/h</td>
      <td>${rec} km/h</td>
      <td>${v.zone_name}</td>
      <td><span class="badge ${v.hazard_status}">${v.hazard_status}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderFusion(state) {
  const container = document.getElementById("fusion-cards");
  if (!container) return;
  container.innerHTML = "";
  Object.entries(state.fusion || {}).forEach(([vid, f]) => {
    const div = document.createElement("div");
    div.className = "fusion-card";
    const sensors = ["radar", "thermal", "v2v", "gps"];
    const tags = sensors
      .map(s => `<span class="${f.contributing_sensors.includes(s) ? "on" : ""}">${s.toUpperCase()}</span>`)
      .join("");
    div.innerHTML = `
      <b>${vid}</b> ${f.detected ? `→ ${f.target_id} @ ${f.distance_m} m` : "(no detection)"}
      &nbsp;<span class="conf-${f.confidence}">${f.confidence}</span>
      <div class="sensor-tags">${tags}</div>
    `;
    container.appendChild(div);
  });
}

function renderV2VLog(state) {
  const log  = document.getElementById("v2v-log");
  const msgs = state.v2v_messages || [];
  log.innerHTML = msgs
    .map(m => `<div class="msg"><b>${m.sender} → ${m.receiver}</b><br>"${m.text}"</div>`)
    .join("") || '<div class="label">No V2V traffic in range.</div>';
}

/* ── Controls ── */
document.getElementById("fog-select").addEventListener("change", e => {
  fetch(`/api/fog/${e.target.value}`, { method: "POST" });
});

let autoOn = false;
document.getElementById("fog-auto-btn").addEventListener("click", () => {
  autoOn = !autoOn;
  fetch(`/api/fog-auto/${autoOn}`, { method: "POST" });
});

let demoActive = false;
document.getElementById("demo-btn").addEventListener("click", () => {
  demoActive = !demoActive;
  fetch(`/api/demo/${demoActive ? "start" : "stop"}`, { method: "POST" });
  if (demoActive) {
    startDemoSequence();
    document.getElementById("demo-btn").textContent = "■ STOP DEMO";
    document.getElementById("demo-btn").classList.add("active");
  } else {
    stopDemoSequence();
    document.getElementById("demo-btn").textContent = "▶ DEMO MODE";
    document.getElementById("demo-btn").classList.remove("active");
    document.getElementById("fog-forecast-panel").style.display = "none";
  }
});

const demoResetBtn = document.getElementById("demo-reset-btn");
if (demoResetBtn) {
  demoResetBtn.addEventListener("click", () => {
    fetch(`/api/demo/reset`, { method: "POST" });
    _actionApplied = false;
    _demoRunning   = false;
    clearTimeout(_demoTimer);
    document.getElementById("fog-forecast-panel").style.display = "none";
    if (demoActive) startDemoSequence();
  });
}

document.getElementById("export-logs-btn")?.addEventListener("click", () => {
  window.open("/api/export-logs", "_blank");
});

const tickSlider    = document.getElementById("tick-rate-slider");
const tickValueSpan = document.getElementById("tick-rate-value");
if (tickSlider) {
  const savedRate = localStorage.getItem("tickRate");
  if (savedRate) tickSlider.value = savedRate;
  const sendRate = rate => {
    fetch(`/api/simulation/tick_rate?rate=${rate}`, { method: "POST" })
      .then(() => {
        tickValueSpan.textContent = `${rate} s/tick`;
        localStorage.setItem("tickRate", rate);
      }).catch(console.error);
  };
  tickSlider.addEventListener("input", e => sendRate(parseFloat(e.target.value)));
  sendRate(parseFloat(tickSlider.value));
}

connectFognetSocket(
  render,
  () => { connDot.classList.add("connected");    connText.textContent = "connected"; },
  () => { connDot.classList.remove("connected"); connText.textContent = "reconnecting..."; }
);

// Draw gauge with initial values
drawVisGauge(200, "CLEAR");

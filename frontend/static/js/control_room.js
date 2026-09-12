const canvas = document.getElementById("twin-canvas");
const ctx = initTwinCanvas(canvas);

/* ── Visibility Gauge (replaces line chart) ── */
const MAX_VIS = 200;

function drawVisGauge(visibility, fogStatus) {
  const c = document.getElementById("vis-gauge-canvas");
  if (!c) return;
  const g = c.getContext("2d");
  const W = c.width;
  const H = c.height;
  g.clearRect(0, 0, W, H);

  const cx = W / 2;
  const cy = H - 8;
  const radius = 100;
  const startAngle = Math.PI;
  const endAngle = 0;

  // background arc track
  g.strokeStyle = "rgba(255,255,255,0.06)";
  g.lineWidth = 20;
  g.lineCap = "butt";
  g.beginPath();
  g.arc(cx, cy, radius, startAngle, endAngle);
  g.stroke();

  // coloured zone segments on the arc
  const zones = [
    { from: 0,    to: 0.15, color: "#e74c3c" },  // EXTREME  0-30m
    { from: 0.15, to: 0.30, color: "#e67e22" },  // HEAVY    30-60m
    { from: 0.30, to: 0.50, color: "#f1c40f" },  // MEDIUM   60-100m
    { from: 0.50, to: 0.75, color: "#9be15d" },  // LIGHT    100-150m
    { from: 0.75, to: 1.00, color: "#2ecc71" },  // CLEAR    150-200m
  ];
  zones.forEach((z) => {
    const a1 = startAngle + z.from * Math.PI;
    const a2 = startAngle + z.to * Math.PI;
    g.strokeStyle = z.color + "55"; // 33% alpha
    g.lineWidth = 18;
    g.beginPath();
    g.arc(cx, cy, radius, a1, a2);
    g.stroke();
  });

  // active arc up to current value
  const pct = Math.min(visibility / MAX_VIS, 1);
  const activeAngle = startAngle + pct * Math.PI;

  // determine colour for current value
  let activeColor = "#2ecc71";
  if (visibility < 30) activeColor = "#e74c3c";
  else if (visibility < 60) activeColor = "#e67e22";
  else if (visibility < 100) activeColor = "#f1c40f";
  else if (visibility < 150) activeColor = "#9be15d";

  // bright arc
  g.strokeStyle = activeColor;
  g.lineWidth = 18;
  g.lineCap = "round";
  g.beginPath();
  g.arc(cx, cy, radius, startAngle, activeAngle);
  g.stroke();

  // glow behind active arc
  g.strokeStyle = activeColor + "30";
  g.lineWidth = 30;
  g.beginPath();
  g.arc(cx, cy, radius, startAngle, activeAngle);
  g.stroke();

  // needle
  const nx = cx + (radius - 28) * Math.cos(activeAngle);
  const ny = cy + (radius - 28) * Math.sin(activeAngle);
  g.strokeStyle = "#d0dde8";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(nx, ny);
  g.stroke();

  // needle tip dot
  const tx = cx + radius * Math.cos(activeAngle);
  const ty = cy + radius * Math.sin(activeAngle);
  g.fillStyle = activeColor;
  g.beginPath();
  g.arc(tx, ty, 5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = activeColor + "40";
  g.beginPath();
  g.arc(tx, ty, 10, 0, Math.PI * 2);
  g.fill();

  // center dot
  g.fillStyle = "#d0dde8";
  g.beginPath();
  g.arc(cx, cy, 4, 0, Math.PI * 2);
  g.fill();

  // value text
  g.textAlign = "center";
  g.fillStyle = activeColor;
  g.font = "bold 28px Segoe UI";
  g.fillText(visibility, cx, cy - 22);
  g.fillStyle = "rgba(200,220,240,0.6)";
  g.font = "11px Segoe UI";
  g.fillText("metres", cx, cy - 8);

  // scale labels
  g.font = "9px Segoe UI";
  g.fillStyle = "rgba(200,220,240,0.35)";
  g.fillText("0", cx - radius - 6, cy + 14);
  g.fillText("200", cx + radius + 6, cy + 14);
  g.fillText("100", cx, cy - radius + 6);
  g.textAlign = "start";

  // update zone indicator dot + label below
  const dotEl = document.getElementById("vis-gauge-dot");
  const labelEl = document.getElementById("vis-gauge-label");
  if (dotEl) dotEl.style.backgroundColor = activeColor;
  if (labelEl) {
    labelEl.textContent = `${visibility} m — ${fogStatus}`;
    labelEl.style.color = activeColor;
  }

  // highlight active zone in the bar
  const statusMap = { CLEAR: "clear", LIGHT: "light", MEDIUM: "medium", HEAVY: "heavy", EXTREME: "extreme" };
  const activeClass = statusMap[fogStatus] || "clear";
  document.querySelectorAll(".vis-zone").forEach((el) => {
    el.classList.remove("active");
  });
  const activeZone = document.querySelector(`.vis-zone-${activeClass}`);
  if (activeZone) activeZone.classList.add("active");
}


const connDot = document.getElementById("conn-dot");
const connText = document.getElementById("conn-text");

function fmtTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString();
}

function render(state) {
  drawTwin(ctx, state);
  renderVehicleTable(state);
  renderFog(state);
  renderRisk(state);
  renderFusion(state);
  renderV2VLog(state);
  renderFleet(state);
  renderEmergencies(state);
  renderDemo(state);

  // Update visibility gauge
  drawVisGauge(state.fog.visibility_m, state.fog.status);

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
    const tr = document.createElement("tr");
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

function renderFog(state) {
  document.getElementById("visibility-value").textContent = `${state.fog.visibility_m} m`;
  const statusEl = document.getElementById("fog-status-value");
  statusEl.textContent = state.fog.status;
  statusEl.className = `value fog-status-${state.fog.status}`;
}

function renderRisk(state) {
  const container = document.getElementById("risk-cards");
  container.innerHTML = "";
  Object.entries(state.risk).forEach(([vid, r]) => {
    if (!r.ahead_id) return;
    const div = document.createElement("div");
    div.className = "fusion-card";
    const ttcText = r.ttc_s !== null ? `${r.ttc_s} s` : "not closing";
    div.innerHTML = `
      <b>${vid} ↔ ${r.ahead_id}</b> &nbsp; <span class="badge ${r.level}">${r.level}</span>
      <div>Gap: ${r.gap_m} m &nbsp; TTC: ${ttcText}</div>
    `;
    container.appendChild(div);
  });
  if (!container.innerHTML) {
    container.innerHTML = '<div class="label">All vehicles clear — no vehicle within sensor range.</div>';
  }
}

function renderFusion(state) {
  const container = document.getElementById("fusion-cards");
  container.innerHTML = "";
  Object.entries(state.fusion).forEach(([vid, f]) => {
    const div = document.createElement("div");
    div.className = "fusion-card";
    const sensors = ["radar", "thermal", "v2v", "gps"];
    const tags = sensors
      .map((s) => `<span class="${f.contributing_sensors.includes(s) ? "on" : ""}">${s.toUpperCase()}</span>`)
      .join("");
    div.innerHTML = `
      <b>${vid}</b> ${f.detected ? `→ ${f.target_id} @ ${f.distance_m} m` : "(no detection)"}
      &nbsp; <span class="conf-${f.confidence}">${f.confidence}</span>
      <div class="sensor-tags">${tags}</div>
    `;
    container.appendChild(div);
  });
}

function renderV2VLog(state) {
  const log = document.getElementById("v2v-log");
  const msgs = state.v2v_messages || [];
  log.innerHTML = msgs
    .map((m) => `<div class="msg"><b>${m.sender} → ${m.receiver}</b><br>"${m.text}"</div>`)
    .join("") || '<div class="label">No V2V traffic in range.</div>';
}

function renderFleet(state) {
  const fleet = state.fleet;
  document.getElementById("fleet-recommendation").textContent = fleet.recommendation;
  document.getElementById("route-a-name").textContent = fleet.route_a.name;
  const a = document.getElementById("route-a-risk");
  a.textContent = fleet.route_a.risk;
  a.className = `route-risk-${fleet.route_a.risk}`;
  document.getElementById("route-b-name").textContent = fleet.route_b.name;
  const b = document.getElementById("route-b-risk");
  b.textContent = fleet.route_b.risk;
  b.className = `route-risk-${fleet.route_b.risk}`;
  document.getElementById("fleet-actions").innerHTML = fleet.actions.map((a) => `<li>${a}</li>`).join("");
}

function renderEmergencies(state) {
  const list = document.getElementById("emergency-list");
  const events = state.emergency_events || [];
  if (!events.length) {
    list.innerHTML = '<div class="label">No active emergencies</div>';
    return;
  }
  list.innerHTML = events
    .slice(0, 8)
    .map(
      (e) => `
      <div class="alert-banner">
        <b>${e.type.replace("_", " ")} — ${e.vehicle_id}</b><br>
        ${e.status} @ ${e.location} (${fmtTime(e.timestamp)})
      </div>`
    )
    .join("");
}

function renderDemo(state) {
  const banner = document.getElementById("demo-banner");
  const demoBtn = document.getElementById("demo-btn");
  if (state.demo && state.demo.active) {
    banner.classList.add("show");
    document.getElementById("demo-step-title").textContent =
      `${state.demo.step_title} (${state.demo.step_index}/${state.demo.step_count})`;
    document.getElementById("demo-step-desc").textContent = state.demo.step_description;
    demoBtn.textContent = "■ STOP DEMO";
    demoBtn.classList.add("active");
  } else {
    banner.classList.remove("show");
    demoBtn.textContent = "▶ DEMO MODE";
    demoBtn.classList.remove("active");
  }
}

document.getElementById("fog-select").addEventListener("change", (e) => {
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
});

// Reset demo button
const demoResetBtn = document.getElementById("demo-reset-btn");
if (demoResetBtn) {
  demoResetBtn.addEventListener("click", () => {
    fetch(`/api/demo/reset`, { method: "POST" });
    demoActive = true;
  });
}

// Tick rate slider handling
const tickSlider = document.getElementById("tick-rate-slider");
const tickValueSpan = document.getElementById("tick-rate-value");
if (tickSlider) {
  const savedRate = localStorage.getItem("tickRate");
  if (savedRate) tickSlider.value = savedRate;
  const sendRate = (rate) => {
    fetch(`/api/simulation/tick_rate?rate=${rate}`, { method: "POST" })
      .then(() => {
        tickValueSpan.textContent = `${rate} s/tick`;
        localStorage.setItem("tickRate", rate);
      })
      .catch(console.error);
  };
  tickSlider.addEventListener("input", (e) => {
    sendRate(parseFloat(e.target.value));
  });
  sendRate(parseFloat(tickSlider.value));
}

connectFognetSocket(
  render,
  () => { connDot.classList.add("connected"); connText.textContent = "connected"; },
  () => { connDot.classList.remove("connected"); connText.textContent = "reconnecting..." }
);

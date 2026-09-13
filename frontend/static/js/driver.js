/**
 * Driver interface — rich and connected to the simulation flow.
 * Shows: status, speed gauge, visibility meter, V2V feed, zone info.
 */
const MAX_VISIBILITY = 200;
const MAX_SPEED = 60;
const params = new URLSearchParams(location.search);
const select = document.getElementById("vehicle-select");
if (params.get("vehicle")) select.value = params.get("vehicle");

const body = document.getElementById("driver-body");

const STATUS_MAP = {
  GREEN:  { text: "SAFE",      icon: "✅" },
  YELLOW: { text: "CAUTION",   icon: "⚠️" },
  ORANGE: { text: "HIGH RISK", icon: "🚨" },
  RED:    { text: "CRITICAL",  icon: "🛑" },
};

let currentLevel = "GREEN";
let audioCtx = null;

function beep(freq, duration) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = freq;
  osc.type = "square";
  gain.gain.value = 0.06;
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

document.addEventListener(
  "click",
  () => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  },
  { once: true }
);

function buzzerLoop() {
  if (currentLevel === "RED") beep(880, 0.18);
  else if (currentLevel === "ORANGE") beep(660, 0.12);
  const nextDelay = currentLevel === "RED" ? 700 : 1400;
  setTimeout(buzzerLoop, nextDelay);
}
buzzerLoop();

/* ── Speed Gauge Drawing ── */
function drawSpeedGauge(speed, recommended) {
  const canvas = document.getElementById("speed-gauge");
  if (!canvas) return;
  const c = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  c.clearRect(0, 0, W, H);

  const cx = W / 2;
  const cy = H - 10;
  const radius = 80;
  const startAngle = Math.PI;
  const endAngle = 0;

  // background arc
  c.strokeStyle = "rgba(255,255,255,0.08)";
  c.lineWidth = 14;
  c.lineCap = "round";
  c.beginPath();
  c.arc(cx, cy, radius, startAngle, endAngle);
  c.stroke();

  // speed arc (green → yellow → red gradient)
  const speedPct = Math.min(speed / MAX_SPEED, 1);
  const speedAngle = startAngle + speedPct * Math.PI;
  const grad = c.createLinearGradient(cx - radius, cy, cx + radius, cy);
  grad.addColorStop(0, "#2ecc71");
  grad.addColorStop(0.5, "#f1c40f");
  grad.addColorStop(1, "#e74c3c");
  c.strokeStyle = grad;
  c.lineWidth = 12;
  c.lineCap = "round";
  c.beginPath();
  c.arc(cx, cy, radius, startAngle, speedAngle);
  c.stroke();

  // recommended speed marker
  if (recommended && recommended > 0) {
    const recPct = Math.min(recommended / MAX_SPEED, 1);
    const recAngle = startAngle + recPct * Math.PI;
    const mx = cx + radius * Math.cos(recAngle);
    const my = cy + radius * Math.sin(recAngle);
    c.fillStyle = "rgba(63,169,245,0.8)";
    c.beginPath();
    c.arc(mx, my, 5, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "rgba(63,169,245,0.3)";
    c.beginPath();
    c.arc(mx, my, 9, 0, Math.PI * 2);
    c.fill();
  }

  // needle
  const needleAngle = startAngle + speedPct * Math.PI;
  const nx = cx + (radius - 20) * Math.cos(needleAngle);
  const ny = cy + (radius - 20) * Math.sin(needleAngle);
  c.strokeStyle = "#e6edf3";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(cx, cy);
  c.lineTo(nx, ny);
  c.stroke();

  // center dot
  c.fillStyle = "#e6edf3";
  c.beginPath();
  c.arc(cx, cy, 4, 0, Math.PI * 2);
  c.fill();

  // speed text
  c.fillStyle = "#e6edf3";
  c.font = "bold 22px Segoe UI";
  c.textAlign = "center";
  c.fillText(speed, cx, cy - 16);
  c.font = "10px Segoe UI";
  c.fillStyle = "rgba(255,255,255,0.6)";
  c.fillText("km/h", cx, cy - 4);
  c.textAlign = "start";

  // scale labels
  c.font = "9px Segoe UI";
  c.fillStyle = "rgba(255,255,255,0.4)";
  c.textAlign = "center";
  c.fillText("0", cx - radius - 4, cy + 12);
  c.fillText(MAX_SPEED, cx + radius + 4, cy + 12);
  c.fillText(MAX_SPEED / 2, cx, cy - radius + 4);
  c.textAlign = "start";
}

function render(state) {
  const vid = select.value;
  const v = state.vehicles[vid];
  const risk = state.risk[vid];
  const rec = state.recommended_speed[vid];
  if (!v || !risk) return;

  currentLevel = v.hazard_status;
  const info = STATUS_MAP[currentLevel] || STATUS_MAP.GREEN;

  body.className = `driver-body status-${currentLevel}`;
  document.getElementById("driver-icon").textContent = info.icon;
  document.getElementById("driver-status").textContent = info.text;

  // Sub-line
  let sub = `Visibility: ${state.fog.visibility_m} m`;
  if (currentLevel === "YELLOW" && risk.ahead_id) sub = `Vehicle ahead – ${risk.gap_m} m`;
  if (currentLevel === "ORANGE" && risk.ttc_s) sub = `Vehicle approaching – TTC ${risk.ttc_s} s`;
  if (currentLevel === "RED") sub = "STOP / BRAKE — Collision risk";
  document.getElementById("driver-sub").textContent = sub;

  // Visibility meter
  const vis = state.fog.visibility_m;
  const fillPct = Math.min(vis, MAX_VISIBILITY) / MAX_VISIBILITY * 100;
  const fillEl = document.getElementById("visibility-fill");
  fillEl.style.width = `${fillPct}%`;
  const meterEl = document.getElementById("visibility-meter");
  meterEl.className = `visibility-meter status-${state.fog.status}`;

  // Speed gauge
  drawSpeedGauge(v.speed_kmh, rec);

  // Tiles
  document.getElementById("tile-speed").textContent = v.speed_kmh;
  document.getElementById("tile-recommended").textContent = rec;
  document.getElementById("tile-distance").textContent = risk.gap_m !== null ? risk.gap_m : "--";
  document.getElementById("tile-ttc").textContent = risk.ttc_s !== null ? risk.ttc_s : "--";

  // V2V feed
  const feedList = document.getElementById("driver-v2v-list");
  const msgs = (state.v2v_messages || []).filter(
    (m) => m.sender === vid || m.receiver === vid
  );
  if (msgs.length) {
    feedList.innerHTML = msgs
      .map((m) => {
        const dir = m.sender === vid ? "→ " + m.receiver : m.sender + " →";
        return `<div class="feed-msg"><b>${dir}</b> ${m.text}</div>`;
      })
      .join("");
  } else {
    feedList.innerHTML = '<div class="feed-empty">No messages</div>';
  }

  // Zone & sensor info
  const fusion = state.fusion ? state.fusion[vid] : null;
  document.getElementById("driver-zone").textContent = `Zone: ${v.zone_name}`;
  if (fusion) {
    document.getElementById("driver-sensors").textContent =
      `Sensors: ${fusion.contributing_sensors.map((s) => s.toUpperCase()).join(", ")}`;
  }
  document.getElementById("driver-fog-status").textContent = `Fog: ${state.fog.status}`;
}

connectFognetSocket(render);

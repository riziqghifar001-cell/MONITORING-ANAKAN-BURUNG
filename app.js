const relays = [
  { id: 1, label: "CH1: Bohlam 1 (Heat)", type: "heat", on: false },
  { id: 2, label: "CH2: Bohlam 2 (Heat)", type: "heat", on: false },
  { id: 3, label: "CH3: Kipas 1 (Cool)", type: "fan", on: false },
  { id: 4, label: "CH4: Kipas 2 (Cool)", type: "fan", on: false }
];

let autoMode = true;
let targetTemp = 33.0;
let currentTemp = null;
let espBaseUrl = localStorage.getItem("esp32_url") || "";
let customStreamUrl = localStorage.getItem("esp32_stream_url") || "";

const relayGrid = document.getElementById("relay-grid");
const tempDisplay = document.getElementById("temp-display");
const humDisplay = document.getElementById("hum-display");
const targetInput = document.getElementById("target-temp");
const modeBtn = document.getElementById("mode-toggle");
const statusBadge = document.getElementById("status-badge");
const espIpInput = document.getElementById("esp-ip");
const streamUrlInput = document.getElementById("stream-url");
const camImg = document.getElementById("cam-stream");
const camPlaceholder = document.getElementById("cam-placeholder");

espIpInput.value = espBaseUrl;
streamUrlInput.value = customStreamUrl;

function setBadge(text, mode = "") {
  statusBadge.textContent = text;
  statusBadge.className = "badge" + (mode ? ` ${mode}` : "");
}

function getResolvedStreamUrl() {
  if (customStreamUrl) return customStreamUrl;
  if (!espBaseUrl) return "";
  return `${espBaseUrl}/stream`;
}

function startStream() {
  const url = getResolvedStreamUrl();
  if (!url) {
    camImg.style.display = "none";
    camImg.removeAttribute("src");
    camPlaceholder.style.display = "block";
    camPlaceholder.textContent = "Masukkan URL/IP ESP32-S3 lalu klik Hubungkan untuk menampilkan live stream.";
    return;
  }
  camPlaceholder.style.display = "block";
  camPlaceholder.textContent = `Menghubungkan ke stream: ${url} ...`;
  camImg.onload = () => {
    camPlaceholder.style.display = "none";
    camImg.style.display = "block";
  };
  camImg.onerror = () => {
    camImg.style.display = "none";
    camPlaceholder.style.display = "block";
    camPlaceholder.textContent = `Gagal memuat stream (${url}). Pastikan ESP32-S3 aktif & tidak kehabisan koneksi HTTP.`;
  };
  const sep = url.includes("?") ? "&" : "?";
  camImg.src = `${url}${sep}t=${Date.now()}`;
}

function renderRelays() {
  relayGrid.innerHTML = "";
  relays.forEach((r) => {
    const btn = document.createElement("button");
    btn.className = "relay-btn" + (r.on ? " on" : "");
    btn.innerHTML = `<span class="name">${r.label}</span><span class="state">${r.on ? "AKTIF (ON)" : "MATI (OFF)"}</span>`;
    btn.onclick = async () => {
      autoMode = false;
      modeBtn.textContent = "Auto: OFF (Manual)";
      const nextState = !r.on;
      await sendRelayState(r.id, nextState);
    };
    relayGrid.appendChild(btn);
  });
}

async function sendRelayState(id, state) {
  const idx = id - 1;
  if (!espBaseUrl) {
    relays[idx].on = state;
    renderRelays();
    return;
  }
  try {
    const res = await fetch(`${espBaseUrl}/relay?ch=${id}&state=${state ? 1 : 0}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.relays) && data.relays.length === 4) {
        relays.forEach((r, i) => { r.on = Boolean(data.relays[i]); });
        renderRelays();
        return;
      }
    }
  } catch (_) {}
  relays[idx].on = state;
  renderRelays();
}

async function enforceAutoHysteresis(temp) {
  if (!autoMode || typeof temp !== "number" || Number.isNaN(temp)) return;
  const low = targetTemp - 0.5;
  const high = targetTemp + 0.5;
  const desired = relays.map((r) => {
    if (temp < low) return r.type === "heat";
    if (temp > high) return r.type === "fan";
    return false;
  });

  for (let i = 0; i < relays.length; i++) {
    if (relays[i].on !== desired[i]) {
      await sendRelayState(relays[i].id, desired[i]);
    }
  }
}

async function pollTelemetry() {
  if (!espBaseUrl) {
    setBadge("Belum Terhubung — Masukkan IP ESP32-S3");
    return;
  }

  try {
    const res = await fetch(`${espBaseUrl}/telemetry`, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP error");
    const data = await res.json();
    currentTemp = Number(data.temp);
    const hum = data.hum !== undefined ? Number(data.hum).toFixed(1) : "--";

    if (!Number.isNaN(currentTemp)) {
      tempDisplay.textContent = `${currentTemp.toFixed(1)} °C`;
    }
    humDisplay.textContent = `Kelembapan: ${hum}% | Hysteresis: ±0.5 °C`;

    if (Array.isArray(data.relays) && data.relays.length === 4) {
      relays.forEach((r, i) => { r.on = Boolean(data.relays[i]); });
      renderRelays();
    }

    setBadge(`Terhubung: ${espBaseUrl}`, "ok");
    await enforceAutoHysteresis(currentTemp);
  } catch (_) {
    setBadge(`Koneksi Gagal: ${espBaseUrl}`, "err");
  }
}

document.getElementById("save-target").onclick = async () => {
  const val = parseFloat(targetInput.value);
  if (!Number.isNaN(val)) {
    targetTemp = val;
    if (currentTemp !== null) {
      await enforceAutoHysteresis(currentTemp);
    }
  }
};

modeBtn.onclick = async () => {
  autoMode = !autoMode;
  modeBtn.textContent = autoMode ? "Auto: ON" : "Auto: OFF (Manual)";
  if (autoMode && currentTemp !== null) {
    await enforceAutoHysteresis(currentTemp);
  }
};

document.getElementById("all-off").onclick = async () => {
  autoMode = false;
  modeBtn.textContent = "Auto: OFF (Manual)";
  for (const r of relays) {
    await sendRelayState(r.id, false);
  }
};

document.getElementById("connect-esp").onclick = () => {
  espBaseUrl = espIpInput.value.trim().replace(/\/+$/, "");
  customStreamUrl = streamUrlInput.value.trim().replace(/\/+$/, "");
  localStorage.setItem("esp32_url", espBaseUrl);
  localStorage.setItem("esp32_stream_url", customStreamUrl);
  startStream();
  pollTelemetry();
};

document.getElementById("reload-stream").onclick = () => {
  startStream();
};

renderRelays();
startStream();
pollTelemetry();
setInterval(pollTelemetry, 2500);

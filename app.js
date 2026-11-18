const DEFAULT_WSS_URL = "wss://q0220110.ala.asia-southeast1.emqxsl.com:8084/mqtt";
const DEFAULT_PREFIX = "brooder/jalak";
const DEFAULT_CAM_URL = "http://192.168.1.14:81/stream";
const ESP_STALE_MS = 10000;

const relays = [
  { id: 1, label: "CH1: Bohlam 1 (Heat)", on: false },
  { id: 2, label: "CH2: Bohlam 2 (Heat)", on: false },
  { id: 3, label: "CH3: Kipas 1 (Cool)", on: false },
  { id: 4, label: "CH4: Kipas 2 (Cool)", on: false }
];

let autoMode = true;
let client = null;
let lastTelemetryAt = 0;
let camRetryTimer = null;
let snapTimer = null;

let brokerUrl = (localStorage.getItem("emqx_wss_url") || DEFAULT_WSS_URL).trim();
let topicPrefix = (localStorage.getItem("emqx_topic_prefix") || DEFAULT_PREFIX).trim().replace(/\/+$/, "");
let mqttUser = localStorage.getItem("emqx_user") || "";
let mqttPass = localStorage.getItem("emqx_pass") || "";
let camUrl = (localStorage.getItem("cam_stream_url") ?? DEFAULT_CAM_URL).trim();
let snapMode = localStorage.getItem("cam_snap_mode") === "1";

const mqttStatusEl = document.getElementById("mqtt-status");
const espStatusEl = document.getElementById("esp-status");
const tempEl = document.getElementById("temp-display");
const humEl = document.getElementById("hum-display");
const lastSeenEl = document.getElementById("last-seen");
const sensorAlertEl = document.getElementById("sensor-alert");
const targetInput = document.getElementById("target-temp");
const modeBtn = document.getElementById("mode-toggle");
const relayGrid = document.getElementById("relay-grid");
const brokerInput = document.getElementById("broker-url");
const prefixInput = document.getElementById("topic-prefix");
const userInput = document.getElementById("mqtt-user");
const passInput = document.getElementById("mqtt-pass");
const camInput = document.getElementById("cam-url");
const snapCheck = document.getElementById("snap-poll");
const camImg = document.getElementById("cam-stream");
const camPlaceholder = document.getElementById("cam-placeholder");

brokerInput.value = brokerUrl;
prefixInput.value = topicPrefix;
userInput.value = mqttUser;
passInput.value = mqttPass;
camInput.value = camUrl;
snapCheck.checked = snapMode;

function setBadge(el, text, type = "") {
  el.textContent = text;
  el.className = "badge" + (type ? ` ${type}` : "");
}

function clearCamTimers() {
  if (camRetryTimer) {
    clearTimeout(camRetryTimer);
    camRetryTimer = null;
  }
  if (snapTimer) {
    clearInterval(snapTimer);
    snapTimer = null;
  }
}

function loadCamFrame() {
  if (!camUrl) {
    camImg.style.display = "none";
    camImg.removeAttribute("src");
    camPlaceholder.style.display = "block";
    camPlaceholder.textContent = "Masukkan URL stream/snapshot kamera lalu klik Terapkan Kamera.";
    return;
  }

  const sep = camUrl.includes("?") ? "&" : "?";
  const nextSrc = `${camUrl}${sep}t=${Date.now()}`;

  camImg.onload = () => {
    if (camRetryTimer) {
      clearTimeout(camRetryTimer);
      camRetryTimer = null;
    }
    camPlaceholder.style.display = "none";
    camImg.style.display = "block";
  };

  camImg.onerror = () => {
    if (!snapMode) {
      camImg.style.display = "none";
    }
    camPlaceholder.style.display = "block";
    camPlaceholder.textContent = `Kamera belum terjangkau (${camUrl}). Cek jaringan/URL atau mode HTTPS->HTTP.`;
    if (!snapMode && !camRetryTimer) {
      camRetryTimer = setTimeout(() => {
        camRetryTimer = null;
        loadCamFrame();
      }, 4000);
    }
  };

  camImg.src = nextSrc;
}

function startCamera() {
  clearCamTimers();
  if (!camUrl) {
    loadCamFrame();
    return;
  }
  camPlaceholder.style.display = "block";
  camPlaceholder.textContent = `Menghubungkan ke kamera: ${camUrl} ...`;
  loadCamFrame();

  if (snapMode) {
    snapTimer = setInterval(loadCamFrame, 3000);
  }
}

function updateEspHealth() {
  if (!lastTelemetryAt) {
    setBadge(espStatusEl, "ESP32-S3: Menunggu Data", "warn");
    return;
  }
  const ageMs = Date.now() - lastTelemetryAt;
  if (ageMs <= ESP_STALE_MS) {
    setBadge(espStatusEl, `ESP32-S3: Online (${Math.round(ageMs / 1000)}d lalu)`, "ok");
  } else {
    setBadge(espStatusEl, `ESP32-S3: Tidak Ada Data (${Math.round(ageMs / 1000)}d)`, "err");
  }
}

function renderRelays() {
  relayGrid.innerHTML = "";
  relays.forEach((r) => {
    const btn = document.createElement("button");
    btn.className = "relay-btn" + (r.on ? " on" : "");
    btn.innerHTML = `<span class="name">${r.label}</span><span class="state">${r.on ? "AKTIF (ON)" : "MATI (OFF)"}</span>`;
    btn.onclick = () => {
      const next = !r.on;
      publishJson(`${topicPrefix}/cmd/relay`, { ch: r.id, state: next ? 1 : 0 });
    };
    relayGrid.appendChild(btn);
  });
}

function publishJson(topic, obj) {
  if (!client || !client.connected) return;
  client.publish(topic, JSON.stringify(obj), { qos: 1 });
}

function connectMqtt() {
  if (client) {
    client.end(true);
    client = null;
  }

  if (!brokerUrl) {
    setBadge(mqttStatusEl, "Broker: URL Kosong", "warn");
    return;
  }

  setBadge(mqttStatusEl, "Broker: Menghubungkan...");
  client = mqtt.connect(brokerUrl, {
    username: mqttUser || undefined,
    password: mqttPass || undefined,
    reconnectPeriod: 3000,
    connectTimeout: 8000
  });

  client.on("connect", () => {
    setBadge(mqttStatusEl, "Broker: Terhubung", "ok");
    client.subscribe(`${topicPrefix}/telemetry`, { qos: 1 });
  });

  client.on("offline", () => {
    setBadge(mqttStatusEl, "Broker: Terputus", "err");
  });

  client.on("error", () => {
    setBadge(mqttStatusEl, "Broker: Error / Auth Gagal", "err");
  });

  client.on("message", (topic, message) => {
    if (topic !== `${topicPrefix}/telemetry`) return;
    try {
      const data = JSON.parse(message.toString());
      lastTelemetryAt = Date.now();
      lastSeenEl.textContent = `Update terakhir: ${new Date(lastTelemetryAt).toLocaleTimeString("id-ID")}`;
      updateEspHealth();

      const tempValid = typeof data.temp === "number" && !Number.isNaN(data.temp);
      const humValid = typeof data.hum === "number" && !Number.isNaN(data.hum);

      tempEl.textContent = tempValid ? `${data.temp.toFixed(1)} °C` : "--.- °C";
      humEl.textContent = `Kelembapan: ${humValid ? `${data.hum.toFixed(1)}%` : "--%"} | Hysteresis: ±0.5 °C`;
      sensorAlertEl.style.display = (!tempValid || !humValid) ? "block" : "none";

      if (typeof data.auto === "boolean") {
        autoMode = data.auto;
        modeBtn.textContent = autoMode ? "Auto: ON" : "Auto: OFF (Manual)";
      }
      if (typeof data.target === "number" && document.activeElement !== targetInput) {
        targetInput.value = data.target.toFixed(1);
      }
      if (Array.isArray(data.relays) && data.relays.length === 4) {
        relays.forEach((r, i) => { r.on = Boolean(data.relays[i]); });
        renderRelays();
      }
    } catch (_) {}
  });
}

document.getElementById("save-target").onclick = () => {
  const val = parseFloat(targetInput.value);
  if (!Number.isNaN(val)) {
    publishJson(`${topicPrefix}/cmd/target`, { target: val });
  }
};

modeBtn.onclick = () => {
  publishJson(`${topicPrefix}/cmd/mode`, { auto: !autoMode });
};

document.getElementById("all-off").onclick = () => {
  publishJson(`${topicPrefix}/cmd/all_off`, {});
};

document.getElementById("apply-cam").onclick = () => {
  camUrl = camInput.value.trim();
  snapMode = snapCheck.checked;
  localStorage.setItem("cam_stream_url", camUrl);
  localStorage.setItem("cam_snap_mode", snapMode ? "1" : "0");
  startCamera();
};

document.getElementById("reload-cam").onclick = () => {
  startCamera();
};

document.getElementById("reconnect-mqtt").onclick = () => {
  brokerUrl = brokerInput.value.trim();
  topicPrefix = prefixInput.value.trim().replace(/\/+$/, "");
  mqttUser = userInput.value.trim();
  mqttPass = passInput.value;

  localStorage.setItem("emqx_wss_url", brokerUrl);
  localStorage.setItem("emqx_topic_prefix", topicPrefix);
  localStorage.setItem("emqx_user", mqttUser);
  localStorage.setItem("emqx_pass", mqttPass);

  connectMqtt();
};

document.getElementById("clear-auth").onclick = () => {
  mqttUser = "";
  mqttPass = "";
  userInput.value = "";
  passInput.value = "";
  localStorage.removeItem("emqx_user");
  localStorage.removeItem("emqx_pass");
  connectMqtt();
};

renderRelays();
connectMqtt();
startCamera();
updateEspHealth();
setInterval(updateEspHealth, 2000);

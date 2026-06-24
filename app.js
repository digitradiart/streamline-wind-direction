const DATA_URL = "data/velocity.json";
const MAP_ZOOM = 5;
const DEFAULT_ANIMATION_INTERVAL = 1200;
const VELOCITY_OPTIONS = {
  displayValues: true,
  displayOptions: {
    velocityType: "Wind",
    position: "bottomleft",
    emptyString: "No wind data",
    angleConvention: "bearingCW",
    speedUnit: "m/s",
  },
  minVelocity: 0,
  velocityScale: 0.035,
  particleAge: 140,
  particleMultiplier: 0.04,
  lineWidth: 1.3,
  frameRate: 30,
  colorScale: ["#2563eb", "#0891b2", "#16a34a", "#ca8a04", "#dc2626"],
};

let frameIndex = 0;
let animationTimer = null;
let velocityLayer = null;
let animate = false;
let dataFrames = [];
let metadata = null;

function showError(message) {
  const existing = document.querySelector(".error");
  if (existing) {
    existing.textContent = message;
    return;
  }
  const errorBox = document.createElement("div");
  errorBox.className = "error";
  errorBox.textContent = message;
  document.body.appendChild(errorBox);
}

function createMap(header) {
  const centerLatitude = (header.la1 + header.la2) / 2;
  const centerLongitude = (header.lo1 + header.lo2) / 2;

  const map = L.map("map", {
    center: [centerLatitude, centerLongitude],
    zoom: MAP_ZOOM,
    preferCanvas: true,
  });
  // "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  https: L.tileLayer(
    "https://tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}{r}.jpg",
    {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 18,
    },
  ).addTo(map);

  return map;
}

function buildFrameData(header, frame) {
  const commonHeader = {
    ...header,
    refTime: frame.time || header.refTime || "",
  };

  return [
    {
      header: {
        ...commonHeader,
        parameterNumber: 2,
        parameterNumberName: "eastward_wind",
      },
      data: frame.u,
    },
    {
      header: {
        ...commonHeader,
        parameterNumber: 3,
        parameterNumberName: "northward_wind",
      },
      data: frame.v,
    },
  ];
}

function updateFrame(map, header, frame) {
  const data = buildFrameData(header, frame);
  if (!velocityLayer) {
    velocityLayer = L.velocityLayer({
      ...VELOCITY_OPTIONS,
      data,
      maxVelocity: Math.max(metadata.maxVelocity || 10, 1),
    }).addTo(map);
  } else {
    velocityLayer.setData(data);
  }
}

function updateToolbar() {
  const timeLabel = document.getElementById("currentTime");
  if (!timeLabel) return;
  if (dataFrames.length === 0) {
    timeLabel.textContent = "No frames available";
    return;
  }
  const frame = dataFrames[frameIndex];
  timeLabel.textContent = frame.time
    ? `Time: ${frame.time}`
    : `Frame ${frameIndex + 1}/${dataFrames.length}`;
}

function stopAnimation() {
  if (animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
    document.getElementById("playPause").textContent = "Play";
  }
}

function startAnimation(map, header) {
  if (animationTimer || dataFrames.length <= 1) {
    return;
  }

  document.getElementById("playPause").textContent = "Pause";
  animationTimer = setInterval(() => {
    frameIndex = (frameIndex + 1) % dataFrames.length;
    updateFrame(map, header, dataFrames[frameIndex]);
    updateToolbar();
  }, DEFAULT_ANIMATION_INTERVAL);
}

function toggleAnimation(map, header) {
  if (!dataFrames.length || dataFrames.length === 1) {
    return;
  }
  animate = !animate;
  if (animate) {
    startAnimation(map, header);
  } else {
    stopAnimation();
  }
}

function setupControls(map, header) {
  const button = document.getElementById("playPause");
  button.addEventListener("click", () => toggleAnimation(map, header));
}

async function loadVelocityData() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to load ${DATA_URL}: ${response.status} ${response.statusText}`,
    );
  }
  return await response.json();
}

async function init() {
  try {
    metadata = await loadVelocityData();
    dataFrames = metadata.frames || [];
    if (!metadata.header || dataFrames.length === 0) {
      throw new Error("Velocity data is invalid or empty.");
    }

    const map = createMap(metadata.header);
    updateFrame(map, metadata.header, dataFrames[0]);
    updateToolbar();
    setupControls(map, metadata.header);

    if (dataFrames.length > 1) {
      animate = true;
      startAnimation(map, metadata.header);
    } else {
      const button = document.getElementById("playPause");
      button.disabled = true;
      button.textContent = "No animation";
    }
  } catch (error) {
    console.error(error);
    showError(error.message);
  }
}

window.addEventListener("load", init);

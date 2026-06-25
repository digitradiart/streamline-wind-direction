const DATA_URL = "data/velocity.json";
const MAP_ZOOM = 5;
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
  velocityScale: 0.02,
  particleAge: 200,
  particleMultiplier: 0.03,
  lineWidth: 1.3,
  frameRate: 25,
  colorScale: ["#2563eb", "#0891b2", "#16a34a", "#ca8a04", "#dc2626"],
};

let frameIndex = 0;
let velocityLayer = null;
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

  const Esri_WorldImagery = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution:
        "Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
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

function formatFrameTime(value) {
  if (!value) {
    return "Unknown time";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function updateToolbar() {
  const timeLabel = document.getElementById("currentTime");
  if (!timeLabel) return;
  if (dataFrames.length === 0) {
    timeLabel.textContent = "No frames available";
    return;
  }
  const frame = dataFrames[frameIndex];
  const timeText = frame.time
    ? formatFrameTime(frame.time)
    : `Frame ${frameIndex + 1}/${dataFrames.length}`;
  timeLabel.textContent = frame.time ? `Time: ${timeText}` : timeText;
}

function showFrame(map, header, index) {
  frameIndex = Math.min(Math.max(index, 0), dataFrames.length - 1);
  updateFrame(map, header, dataFrames[frameIndex]);
  updateToolbar();
}

function showPreviousFrame(map, header) {
  if (frameIndex > 0) {
    showFrame(map, header, frameIndex - 1);
  }
}

function showNextFrame(map, header) {
  if (frameIndex < dataFrames.length - 1) {
    showFrame(map, header, frameIndex + 1);
  }
}

function setupControls(map, header) {
  const prevButton = document.getElementById("prevFrame");
  const nextButton = document.getElementById("nextFrame");

  prevButton.addEventListener("click", () => showPreviousFrame(map, header));
  nextButton.addEventListener("click", () => showNextFrame(map, header));
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

    if (dataFrames.length <= 1) {
      document.getElementById("prevFrame").disabled = true;
      document.getElementById("nextFrame").disabled = true;
    }
  } catch (error) {
    console.error(error);
    showError(error.message);
  }
}

window.addEventListener("load", init);

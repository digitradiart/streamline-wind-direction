const DATA_URL = "data/velocity.json";
const MAP_ZOOM = 5;
const MAP_ZOOM_STEP = 1;
const VELOCITY_OPTIONS = {
  displayValues: true,
  displayOptions: {
    velocityType: "Wind",
    position: "bottomleft",
    emptyString: "No wind data",
    angleConvention: "bearingCW",
    speedUnit: "m/s",
  },
  // setting velocityScale to 0.008 to make the wind speed more visually appealing
  minVelocity: 0,
  velocityScale: 0.008,
  particleAge: 280,
  particleMultiplier: 0.03,
  lineWidth: 1.3,
  frameRate: 25,
  colorScale: ["#2563eb", "#0891b2", "#16a34a", "#ca8a04", "#dc2626"],
};

let frameIndex = 0;
let velocityLayer = null;
let dataFrames = [];
let metadata = null;
let initialMapView = null;

function renderIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function updateFrameButtons() {
  const prevButton = document.getElementById("prevFrame");
  const nextButton = document.getElementById("nextFrame");
  if (!prevButton || !nextButton) return;

  prevButton.disabled = dataFrames.length <= 1 || frameIndex <= 0;
  nextButton.disabled =
    dataFrames.length <= 1 || frameIndex >= dataFrames.length - 1;
}

function updateZoomButtons(map) {
  const zoomInButton = document.getElementById("zoomIn");
  const zoomOutButton = document.getElementById("zoomOut");
  if (!zoomInButton || !zoomOutButton) return;

  zoomInButton.disabled = map.getZoom() >= map.getMaxZoom();
  zoomOutButton.disabled = map.getZoom() <= map.getMinZoom();
}

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
  const center = [centerLatitude, centerLongitude];
  initialMapView = {
    center,
    zoom: MAP_ZOOM,
  };

  const map = L.map("map", {
    center,
    zoom: MAP_ZOOM,
    zoomControl: false,
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

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(value) {
  return value
    .replace(/[^a-zA-Z0-9-_\.]/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

function currentFrameFilenameSuffix() {
  const frame = dataFrames[frameIndex] || {};
  if (frame.time) {
    const date = new Date(frame.time);
    if (!Number.isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const hour = String(date.getHours()).padStart(2, "0");
      const minute = String(date.getMinutes()).padStart(2, "0");
      return `${year}${month}${day}_${hour}${minute}`;
    }
    return sanitizeFilename(frame.time);
  }
  return `frame-${String(frameIndex + 1).padStart(3, "0")}`;
}

async function downloadMapImage() {
  const mapEl = document.getElementById("map");
  const canvas = await html2canvas(mapEl, {
    useCORS: true,
    backgroundColor: null,
  });
  canvas.toBlob((blob) => {
    if (blob) {
      const suffix = currentFrameFilenameSuffix();
      downloadBlob(blob, `wind-map-${suffix}.png`);
    }
  }, "image/png");
}

function createMediaRecorder(stream) {
  const options = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];

  for (const mimeType of options) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return new MediaRecorder(stream, { mimeType });
    }
  }

  return new MediaRecorder(stream);
}

async function downloadMapVideo(map, header) {
  const originalIndex = frameIndex;
  const suffix = currentFrameFilenameSuffix();
  const mapEl = document.getElementById("map");
  const stream = mapEl.captureStream(25);
  const recorder = createMediaRecorder(stream);
  const chunks = [];

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const stopped = new Promise((resolve, reject) => {
    recorder.onstop = resolve;
    recorder.onerror = reject;
  });

  recorder.start();
  const frameCount = Math.min(8, dataFrames.length || 1);
  for (let i = 0; i < frameCount; i += 1) {
    const nextIndex = (originalIndex + i) % dataFrames.length;
    showFrame(map, header, nextIndex);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  recorder.stop();
  await stopped;
  showFrame(map, header, originalIndex);

  const blob = new Blob(chunks, { type: recorder.mimeType });
  downloadBlob(blob, `wind-map-${suffix}.webm`);
}

async function captureGifFrames(map, header, frameCount) {
  const originalIndex = frameIndex;
  const frames = [];

  for (let i = 0; i < frameCount; i += 1) {
    const nextIndex = (originalIndex + i) % dataFrames.length;
    showFrame(map, header, nextIndex);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 150));
    const canvas = await html2canvas(document.getElementById("map"), {
      useCORS: true,
      backgroundColor: null,
    });
    frames.push(canvas);
  }

  showFrame(map, header, originalIndex);
  return frames;
}

async function downloadMapGif(map, header) {
  const frameCount = Math.min(8, dataFrames.length || 1);
  const suffix = currentFrameFilenameSuffix();
  const gif = new GIF({
    workers: 2,
    quality: 10,
    workerScript:
      "https://cdn.jsdelivr.net/npm/gif.js.optimized/dist/gif.worker.js",
    width: document.getElementById("map").clientWidth,
    height: document.getElementById("map").clientHeight,
  });

  const frames = await captureGifFrames(map, header, frameCount);

  gif.on("finished", (blob) => {
    downloadBlob(blob, `wind-map-${suffix}.gif`);
  });

  frames.forEach((canvas) => {
    gif.addFrame(canvas, { delay: 250, copy: true });
  });

  gif.render();
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
  const titleLabel = document.getElementById("mapTitle");
  if (!timeLabel) return;
  if (!titleLabel) return;
  if (dataFrames.length === 0) {
    titleLabel.textContent = "Wind Streamline Visualization";
    timeLabel.textContent = "No frames available";
    updateFrameButtons();
    return;
  }
  const frame = dataFrames[frameIndex];
  const timeText = frame.time
    ? formatFrameTime(frame.time)
    : `Frame ${frameIndex + 1}/${dataFrames.length}`;
  titleLabel.textContent = frame.time
    ? `Wind Streamline — ${timeText}`
    : "Wind Streamline Visualization";
  titleLabel.textContent = "Wind Streamline Visualization";
  timeLabel.textContent = frame.time ? `Time: ${timeText}` : timeText;
  updateFrameButtons();
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
  const zoomInButton = document.getElementById("zoomIn");
  const zoomOutButton = document.getElementById("zoomOut");
  const resetViewButton = document.getElementById("resetView");
  const prevButton = document.getElementById("prevFrame");
  const nextButton = document.getElementById("nextFrame");
  const downloadImageButton = document.getElementById("downloadImage");
  const downloadVideoButton = document.getElementById("downloadVideo");
  const downloadGifButton = document.getElementById("downloadGif");

  zoomInButton.addEventListener("click", () => map.zoomIn(MAP_ZOOM_STEP));
  zoomOutButton.addEventListener("click", () => map.zoomOut(MAP_ZOOM_STEP));
  resetViewButton.addEventListener("click", () => {
    if (initialMapView) {
      map.setView(initialMapView.center, initialMapView.zoom);
    }
  });
  prevButton.addEventListener("click", () => showPreviousFrame(map, header));
  nextButton.addEventListener("click", () => showNextFrame(map, header));
  downloadImageButton.addEventListener("click", downloadMapImage);
  downloadVideoButton.addEventListener("click", () =>
    downloadMapVideo(map, header),
  );
  downloadGifButton.addEventListener("click", () =>
    downloadMapGif(map, header),
  );
  map.on("zoomend", () => updateZoomButtons(map));
  updateZoomButtons(map);
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
    renderIcons();

    metadata = await loadVelocityData();
    dataFrames = metadata.frames || [];
    if (!metadata.header || dataFrames.length === 0) {
      throw new Error("Velocity data is invalid or empty.");
    }

    const map = createMap(metadata.header);
    updateFrame(map, metadata.header, dataFrames[0]);
    updateToolbar();
    setupControls(map, metadata.header);
  } catch (error) {
    console.error(error);
    showError(error.message);
  }
}

window.addEventListener("load", init);

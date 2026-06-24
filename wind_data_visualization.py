import argparse
import json
from pathlib import Path

import numpy as np
import xarray as xr
import folium
from branca.element import Element


def parse_args():
    parser = argparse.ArgumentParser(
        description="Create an interactive wind streamline map from wind-data NetCDF."
    )
    parser.add_argument(
        "--input",
        default="wind-data/data_stream-oper_stepType-instant.nc",
        help="Input NetCDF file from wind-data folder.",
    )
    parser.add_argument(
        "--output",
        default="index.html",
        help="Output HTML map file.",
    )
    parser.add_argument(
        "--time-index",
        type=int,
        default=0,
        help="Time index to visualize when not animating.",
    )
    parser.add_argument(
        "--stride",
        type=int,
        default=2,
        help="Use every Nth grid point to reduce HTML size.",
    )
    parser.add_argument(
        "--animate",
        action="store_true",
        help="Create an animated streamlines map over all available time steps.",
    )
    parser.add_argument(
        "--interval-ms",
        type=int,
        default=700,
        help="Animation interval in milliseconds when --animate is enabled.",
    )
    return parser.parse_args()


def find_coordinate(ds, names):
    for name in names:
        if name in ds.coords:
            return name
    raise ValueError(f"Coordinate not found among candidates: {names}")


def find_variable(ds, names):
    for name in names:
        if name in ds.data_vars:
            return name
    raise ValueError(f"Variable not found among candidates: {names}")


def normalize_dataset(ds, stride):
    lat_name = find_coordinate(ds, ["latitude", "lat", "y"])
    lon_name = find_coordinate(ds, ["longitude", "lon", "x"])
    time_name = None
    for candidate in ["valid_time", "time", "date", "forecast_time"]:
        if candidate in ds.coords:
            time_name = candidate
            break

    ds = ds[[find_variable(ds, ["u10", "eastward_wind", "u"]), find_variable(ds, ["v10", "northward_wind", "v"])]]

    if stride > 1:
        ds = ds.isel({lat_name: slice(None, None, stride), lon_name: slice(None, None, stride)})

    if lat_name in ds.coords and ds[lat_name].values[0] < ds[lat_name].values[-1]:
        ds = ds.sortby(lat_name, ascending=False)

    return ds, lat_name, lon_name, time_name


def build_header(lats, lons, ref_time):
    dx = float(abs(lons[1] - lons[0])) if lons.size > 1 else 0.0
    dy = float(abs(lats[1] - lats[0])) if lats.size > 1 else 0.0
    return {
        "parameterCategory": 2,
        "parameterUnit": "m.s-1",
        "nx": int(lons.size),
        "ny": int(lats.size),
        "lo1": float(lons.min()),
        "lo2": float(lons.max()),
        "la1": float(lats.max()),
        "la2": float(lats.min()),
        "dx": dx,
        "dy": dy,
        "refTime": ref_time,
    }


def frame_data(u_array, v_array, header):
    return [
        {"header": {**header, "parameterNumber": 2, "parameterNumberName": "eastward_wind"}, "data": u_array.flatten().round(3).tolist()},
        {"header": {**header, "parameterNumber": 3, "parameterNumberName": "northward_wind"}, "data": v_array.flatten().round(3).tolist()},
    ]


def build_one_frame(ds, lat_name, lon_name, time_name, time_index):
    u_name = find_variable(ds, ["u10", "eastward_wind", "u"])
    v_name = find_variable(ds, ["v10", "northward_wind", "v"])
    if time_name is not None:
        ref_time = str(ds[time_name].values[time_index])
        ds = ds.isel({time_name: time_index})
    else:
        ref_time = ""
    lats = ds[lat_name].values
    lons = ds[lon_name].values
    header = build_header(lats, lons, ref_time)
    u = np.nan_to_num(ds[u_name].values, nan=0.0).astype(float)
    v = np.nan_to_num(ds[v_name].values, nan=0.0).astype(float)
    wind_speed = np.sqrt(u ** 2 + v ** 2)
    return frame_data(u, v, header), lats, lons, wind_speed, ref_time


def build_animation(ds, lat_name, lon_name, time_name):
    if time_name is None:
        raise ValueError("Animation requires a time coordinate.")
    u_name = find_variable(ds, ["u10", "eastward_wind", "u"])
    v_name = find_variable(ds, ["v10", "northward_wind", "v"])
    n_steps = ds.sizes[time_name]
    lats = ds[lat_name].values
    lons = ds[lon_name].values
    time_values = ds[time_name].values
    frames = []
    u_all = np.nan_to_num(ds[u_name].values, nan=0.0).astype(float)
    v_all = np.nan_to_num(ds[v_name].values, nan=0.0).astype(float)
    wind_speed = np.sqrt(u_all ** 2 + v_all ** 2)
    max_velocity = max(1.0, float(np.nanpercentile(wind_speed, 98)))
    for step in range(n_steps):
        frames.append(
            {
                "time": str(time_values[step]),
                "u": u_all[step].flatten().round(3).tolist(),
                "v": v_all[step].flatten().round(3).tolist(),
            }
        )
    header = build_header(lats, lons, str(time_values[0]))
    return frames, header, lats, lons, max_velocity


def create_map(output_path, frames, header, lats, lons, max_velocity, animate, interval_ms):
    center = [float((lats.max() + lats.min()) / 2), float((lons.max() + lons.min()) / 2)]
    m = folium.Map(location=center, zoom_start=5, tiles=None, control_scale=True)
    folium.TileLayer(tiles="https://tile.openstreetmap.org/{z}/{x}/{y}.png", attr="© OpenStreetMap contributors", name="OpenStreetMap").add_to(m)
    folium.TileLayer(tiles="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attr="Map data: OpenStreetMap contributors, SRTM | OpenTopoMap", name="OpenTopoMap").add_to(m)

    map_name = m.get_name()
    frames_json = json.dumps(frames, separators=(",", ":"))
    header_json = json.dumps(header, separators=(",", ":"))
    max_velocity = float(max_velocity)

    if animate:
        start_time = frames[0]["time"].replace("T", " ").replace(".000000000", "")
        velocity_assets = """
<script src="https://unpkg.com/leaflet-velocity/dist/leaflet-velocity.min.js"></script>
<style>
.wind-panel {
  position: fixed;
  z-index: 9999;
  left: 16px;
  right: 16px;
  bottom: 16px;
  max-width: 720px;
  padding: 10px 12px;
  background: rgba(255,255,255,0.94);
  border: 1px solid rgba(0,0,0,0.16);
  border-radius: 6px;
  color: #111827;
  font: 13px/1.35 Arial, sans-serif;
  box-shadow: 0 1px 6px rgba(0,0,0,0.18);
}
.wind-panel__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.wind-panel__title {
  font-weight: 700;
}
.wind-panel__controls {
  display: grid;
  grid-template-columns: 72px minmax(0,1fr) 56px;
  gap: 10px;
  align-items: center;
}
.wind-panel button {
  height: 30px;
  border: 1px solid #9ca3af;
  border-radius: 5px;
  background: #fff;
  color: #111827;
  cursor: pointer;
  font: inherit;
}
.wind-panel input[type=range] {
  width: 100%;
}
</style>
"""
        panel_html = f"""
<div class="wind-panel">
  <div class="wind-panel__top">
    <div class="wind-panel__title">Wind velocity 10 m</div>
    <div class="wind-panel__time" id="wind-time">{start_time} UTC</div>
  </div>
  <div class="wind-panel__controls">
    <button type="button" id="wind-play">Pause</button>
    <input type="range" id="wind-slider" min="0" max="{len(frames) - 1}" step="1" value="0">
    <span id="wind-index">1/{len(frames)}</span>
  </div>
</div>
"""
        velocity_script = f"""
window.addEventListener('load', function() {{
  var map = {map_name};
  var frames = {frames_json};
  var header = {header_json};
  var currentIndex = 0;
  var playing = true;
  var timerId = null;
  var slider = document.getElementById('wind-slider');
  var playButton = document.getElementById('wind-play');
  var timeLabel = document.getElementById('wind-time');
  var indexLabel = document.getElementById('wind-index');

  function frameData(index) {{
    return [
      {{header: Object.assign({{}}, header, {{refTime: frames[index].time, parameterNumber: 2, parameterNumberName: 'eastward_wind'}}), data: frames[index].u}},
      {{header: Object.assign({{}}, header, {{refTime: frames[index].time, parameterNumber: 3, parameterNumberName: 'northward_wind'}}), data: frames[index].v}}
    ];
  }}

  var velocityLayer = L.velocityLayer({{
    data: frameData(0),
    displayValues: true,
    displayOptions: {{velocityType: 'Wind', position: 'bottomleft', emptyString: 'No wind data', angleConvention: 'bearingCW', speedUnit: 'm/s'}},
    minVelocity: 0,
    maxVelocity: {max_velocity},
    velocityScale: 0.008,
    particleAge: 80,
    particleMultiplier: 0.004,
    lineWidth: 1.2,
    frameRate: 24,
    colorScale: ['#2563eb', '#0891b2', '#16a34a', '#ca8a04', '#dc2626']
  }});
  velocityLayer.addTo(map);

  function renderFrame(index) {{
    currentIndex = index;
    slider.value = index;
    indexLabel.textContent = (index + 1) + '/' + frames.length;
    timeLabel.textContent = frames[index].time.replace('T', ' ').replace('.000000000', '') + ' UTC';
    if (typeof velocityLayer.setData === 'function') {{
      velocityLayer.setData(frameData(index));
    }}
  }}

  function nextFrame() {{
    renderFrame((currentIndex + 1) % frames.length);
  }}

  function startTimer() {{
    stopTimer();
    timerId = window.setInterval(nextFrame, {interval_ms});
  }}

  function stopTimer() {{
    if (timerId !== null) {{
      window.clearInterval(timerId);
      timerId = null;
    }}
  }}

  playButton.addEventListener('click', function() {{
    playing = !playing;
    playButton.textContent = playing ? 'Pause' : 'Play';
    if (playing) {{
      startTimer();
    }} else {{
      stopTimer();
    }}
  }});

  slider.addEventListener('input', function(event) {{
    renderFrame(Number(event.target.value));
  }});

  startTimer();
}});
"""
        m.get_root().header.add_child(Element(velocity_assets))
        m.get_root().html.add_child(Element(panel_html))
        m.get_root().script.add_child(Element(velocity_script))
    else:
        velocity_assets = """
<script src="https://unpkg.com/leaflet-velocity/dist/leaflet-velocity.min.js"></script>
"""
        velocity_script = f"""
window.addEventListener('load', function() {{
  var map = {map_name};
  var data = {json.dumps(frames, separators=(',', ':'))};
  var velocityLayer = L.velocityLayer({{
    data: data,
    displayValues: true,
    displayOptions: {{velocityType: 'Wind', position: 'bottomleft', emptyString: 'No wind data', angleConvention: 'bearingCW', speedUnit: 'm/s'}},
    minVelocity: 0,
    maxVelocity: {max_velocity:.2f},
    velocityScale: 0.008,
    particleAge: 90,
    particleMultiplier: 0.004,
    lineWidth: 1.2,
    frameRate: 24,
    colorScale: ['#2563eb', '#0891b2', '#16a34a', '#ca8a04', '#dc2626']
  }});
  velocityLayer.addTo(map);
}});
"""
        m.get_root().header.add_child(Element(velocity_assets))
        m.get_root().script.add_child(Element(velocity_script))

    m.save(output_path)
    print(f"Saved {output_path}")


def main():
    args = parse_args()
    target = Path(args.input)
    if not target.exists():
        raise FileNotFoundError(f"Input file not found: {target}")
    ds = xr.open_dataset(str(target))
    ds, lat_name, lon_name, time_name = normalize_dataset(ds, args.stride)

    if args.animate:
        frames, header, lats, lons, max_velocity = build_animation(ds, lat_name, lon_name, time_name)
        create_map(args.output, frames, header, lats, lons, max_velocity, animate=True, interval_ms=args.interval_ms)
    else:
        frame, lats, lons, wind_speed, ref_time = build_one_frame(ds, lat_name, lon_name, time_name, args.time_index)
        max_velocity = max(1.0, float(np.nanpercentile(wind_speed, 98)))
        create_map(args.output, frame, frame[0]["header"], lats, lons, max_velocity, animate=False, interval_ms=args.interval_ms)


if __name__ == "__main__":
    main()

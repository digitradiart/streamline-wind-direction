import argparse
import gzip
import json
from pathlib import Path

import numpy as np
import xarray as xr


def parse_args():
    parser = argparse.ArgumentParser(
        description='Export wind velocity data from NetCDF into a lightweight JSON file.'
    )
    parser.add_argument(
        '--input',
        default='wind-data/data_stream-oper_stepType-instant.nc',
        help='Input NetCDF file containing u10/v10 wind components.',
    )
    parser.add_argument(
        '--output',
        default='data/velocity.json',
        help='Output JSON path for velocity data.',
    )
    parser.add_argument(
        '--stride',
        type=int,
        default=2,
        help='Spatial stride for latitude and longitude to reduce resolution.',
    )
    parser.add_argument(
        '--time-step',
        type=int,
        default=None,
        help='Sample every Nth time index from the NetCDF file.',
    )
    parser.add_argument(
        '--max-frames',
        type=int,
        default=120,
        help='Maximum number of output time frames when animating.',
    )
    parser.add_argument(
        '--single-frame',
        action='store_true',
        help='Export only a single frame for a non-animated map.',
    )
    return parser.parse_args()


def find_coordinate(ds, names):
    for name in names:
        if name in ds.coords:
            return name
    raise ValueError(f'Coordinate not found among candidates: {names}')


def find_variable(ds, names):
    for name in names:
        if name in ds.data_vars:
            return name
    raise ValueError(f'Variable not found among candidates: {names}')


def normalize_dataset(ds, stride):
    lat_name = find_coordinate(ds, ['latitude', 'lat', 'y'])
    lon_name = find_coordinate(ds, ['longitude', 'lon', 'x'])
    time_name = None
    for candidate in ['valid_time', 'time', 'date', 'forecast_time']:
        if candidate in ds.coords:
            time_name = candidate
            break

    u_name = find_variable(ds, ['u10', 'eastward_wind', 'u'])
    v_name = find_variable(ds, ['v10', 'northward_wind', 'v'])
    ds = ds[[u_name, v_name]]

    if stride > 1:
        ds = ds.isel({lat_name: slice(None, None, stride), lon_name: slice(None, None, stride)})

    if lat_name in ds.coords and ds[lat_name].values[0] < ds[lat_name].values[-1]:
        ds = ds.sortby(lat_name, ascending=False)

    return ds, lat_name, lon_name, time_name, u_name, v_name


def build_header(lat_values, lon_values, ref_time):
    dx = float(abs(lon_values[1] - lon_values[0])) if lon_values.size > 1 else 0.0
    dy = float(abs(lat_values[1] - lat_values[0])) if lat_values.size > 1 else 0.0
    return {
        'parameterCategory': 2,
        'parameterUnit': 'm.s-1',
        'nx': int(lon_values.size),
        'ny': int(lat_values.size),
        'lo1': float(lon_values.min()),
        'lo2': float(lon_values.max()),
        'la1': float(lat_values.max()),
        'la2': float(lat_values.min()),
        'dx': dx,
        'dy': dy,
        'refTime': ref_time,
    }


def select_time_indices(n_frames, time_step, max_frames, single_frame):
    if single_frame or n_frames <= 1:
        return [0]
    if time_step is not None and time_step >= 1:
        return list(range(0, n_frames, time_step))
    if max_frames is not None and n_frames > max_frames:
        indices = np.linspace(0, n_frames - 1, num=max_frames, dtype=int)
        return sorted(set(int(i) for i in indices))
    return list(range(n_frames))


def build_velocity_payload(ds, lat_name, lon_name, time_name, u_name, v_name, time_indices, spatial_stride):
    lat_values = ds[lat_name].values
    lon_values = ds[lon_name].values
    header = build_header(lat_values, lon_values, '')
    u_arr = np.nan_to_num(ds[u_name].values, nan=0.0).astype(float)
    v_arr = np.nan_to_num(ds[v_name].values, nan=0.0).astype(float)
    time_values = ds[time_name].values if time_name is not None else [None]

    frames = []
    for index in time_indices:
        frame_time = str(time_values[index]) if time_name is not None else ''
        frames.append(
            {
                'time': frame_time,
                'u': u_arr[index].flatten().round(3).tolist(),
                'v': v_arr[index].flatten().round(3).tolist(),
            }
        )

    if time_name is not None:
        header['refTime'] = frames[0]['time']

    wind_speed = np.sqrt(u_arr ** 2 + v_arr ** 2)
    max_velocity = max(1.0, float(np.nanpercentile(wind_speed, 98)))

    return {
        'header': header,
        'frames': frames,
        'maxVelocity': max_velocity,
        'grid': {
            'latitude': lat_values.tolist(),
            'longitude': lon_values.tolist(),
        },
        'source': {
            'dataset': str(ds.encoding.get('source', 'netCDF')),
            'time_stride': int(time_indices[1] - time_indices[0]) if len(time_indices) > 1 else 1,
            'time_count': len(time_indices),
            'spatial_stride': int(spatial_stride),
        },
    }


def write_json(payload, output_path):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.suffix == '.gz':
        with gzip.open(output_path, 'wt', encoding='utf-8') as handle:
            json.dump(payload, handle, separators=(',', ':'), ensure_ascii=False)
    else:
        with output_path.open('w', encoding='utf-8') as handle:
            json.dump(payload, handle, separators=(',', ':'), ensure_ascii=False)


def main():
    args = parse_args()
    ds = xr.open_dataset(args.input)
    ds, lat_name, lon_name, time_name, u_name, v_name = normalize_dataset(ds, args.stride)

    if time_name is None:
        raise ValueError('Input dataset must contain a time coordinate for animation or selection.')

    n_frames = ds.sizes[time_name]
    time_indices = select_time_indices(n_frames, args.time_step, args.max_frames, args.single_frame)

    payload = build_velocity_payload(
        ds,
        lat_name,
        lon_name,
        time_name,
        u_name,
        v_name,
        time_indices,
        args.stride,
    )
    write_json(payload, args.output)
    print(f'Saved {args.output} with {len(payload["frames"])} frames, spatial stride {args.stride}.')


if __name__ == '__main__':
    main()

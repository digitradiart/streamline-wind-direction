This project visualizes wind streamlines from ERA5 hourly surface wind data. I'm trying to visualize streamline for wind direction and speed, using the data that I've downloaded from Copernicus [https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels?tab=overview]()

Files:

- `wind_data_visualization.py`: converts NetCDF wind data to a lightweight JSON file.
- `index.html`, `styles.css`, `app.js`: separate HTML, CSS, and JavaScript for the map.
- `data/velocity.json`: exported velocity payload used by the browser.

Usage:

1. Run `python wind_data_visualization.py --output data/velocity.json --stride 2 --max-frames 120`
2. Open `index.html` in a browser or serve the folder with a local HTTP server.

Data source:

- Wind data is derived from ERA5 hourly surface wind fields, downloaded from the Copernicus Climate Data Store.
- The input NetCDF files in `wind-data/` are the original source files used to generate `data/velocity.json`.
- The exporter converts the ERA5 u/v wind components into a lightweight JSON payload for browser visualization.

Data notes:

- The exporter samples the input grid with `--stride` to reduce size.
- `--max-frames` limits animation frames to a lighter subset of the monthly hourly data.

For a heavier dataset, use compressed JSON or increase `--stride` / reduce `--max-frames`.

basemap: [leaflet-extras.github.io/leaflet-providers/preview](https://leaflet-extras.github.io/leaflet-providers/preview/)

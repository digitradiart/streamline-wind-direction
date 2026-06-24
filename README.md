This project visualizes wind streamlines from ERA5 hourly surface wind data.

Files:

- `wind_data_visualization.py`: converts NetCDF wind data to a lightweight JSON file.
- `index.html`, `styles.css`, `app.js`: separate HTML, CSS, and JavaScript for the map.
- `data/velocity.json`: exported velocity payload used by the browser.

Usage:

1. Run `python wind_data_visualization.py --output data/velocity.json --stride 2 --max-frames 120`
2. Open `index.html` in a browser or serve the folder with a local HTTP server.

Data notes:

- The exporter samples the input grid with `--stride` to reduce size.
- `--max-frames` limits animation frames to a lighter subset of the monthly hourly data.

For a heavier dataset, use compressed JSON or increase `--stride` / reduce `--max-frames`.

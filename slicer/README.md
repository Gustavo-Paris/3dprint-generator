# 3dprint-slicer

Lightweight Express microservice that wraps OrcaSlicer CLI for STL → 3MF slicing.

## Endpoints

- `GET /health` — returns `{ ok: true, orca, profiles_dir }`. Use to verify the service is up and the binary path is set.
- `POST /slice` — accepts `{ stl_base64: string }` (base64-encoded STL), runs OrcaSlicer with bundled profiles, and returns `{ bytes_base64, meta: { print_time_min, filament_g, stdout_tail } }`. Requires profiles to be bundled (TASK-024).

## Running locally

Started via `docker-compose up slicer` from the repo root. The container is pinned to `linux/amd64` (qemu emulation on Apple Silicon) because OrcaSlicer only ships x86_64 AppImages.

## Environment variables

- `ORCA_BIN` — path to the extracted AppRun binary (default: `/opt/orca/orca-extracted/AppRun`)
- `PORT` — HTTP port (default: `8787`)

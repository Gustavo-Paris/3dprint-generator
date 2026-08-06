#!/usr/bin/env bash
# IFC → LSF print maquete (golden recipe).
# Requires: text-to-cad venv with ifcopenshell + trimesh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKER="${LSF_WORKER:-$HOME/www/cad-workshop/parts/lsf-maquete/lsf_maquette.py}"
VENV_PY="${LSF_PYTHON:-$HOME/www/text-to-cad/.venv/bin/python}"

if [[ ! -x "$VENV_PY" ]]; then
  echo "Python venv not found: $VENV_PY" >&2
  echo "Set LSF_PYTHON=… or install ifcopenshell+trimesh." >&2
  exit 1
fi
if [[ ! -f "$WORKER" ]]; then
  echo "Worker not found: $WORKER" >&2
  exit 1
fi
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <file.ifc> [-o out-dir] [--name NAME] [lsf_maquette.py flags…]" >&2
  echo "Example:" >&2
  echo "  $0 ~/path/house.ifc -o /tmp/lsf-out --name CasaX" >&2
  exit 1
fi

exec "$VENV_PY" "$WORKER" "$@"

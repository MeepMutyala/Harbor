#!/bin/bash
# Harbor Bridge Launcher
# This script is called by Firefox to start the native messaging bridge

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_DIR="$(dirname "$SCRIPT_DIR")"

cd "$BRIDGE_DIR"

# Use uv run which handles venv automatically
exec uv run python -m harbor_bridge.main

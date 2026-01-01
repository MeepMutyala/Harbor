#!/bin/bash
# Simple HTTP server for the Harbor demo
# Usage: ./serve.sh [port]

PORT=${1:-8000}

echo "Starting demo server on http://localhost:$PORT"
echo "Open this URL in Firefox with the Harbor extension installed"
echo ""
echo "Press Ctrl+C to stop"

python3 -m http.server $PORT


#!/usr/bin/env bash
# Lanzador del tutor bridge para macOS / Linux.
cd "$(dirname "$0")" || exit 1
echo
echo "  Tutor UI - bridge local (Claude Code)"
echo "  Cuando diga 'bridge activo', abrí:  http://localhost:8770"
echo "  Ctrl+C para salir."
echo
node chat-server.js

#!/usr/bin/env bash
# Lanzador del tutor bridge para macOS / Linux.
cd "$(dirname "$0")" || exit 1
echo
echo "  Tutor UI - bridge local"
echo "  La primera vez pregunta cómo hablar con Claude (CLI logueado o API key)."
echo "  Cuando diga 'Tutor listo', abrí el link que imprime abajo."
echo "  Ctrl+C para salir · reconfigurar: node chat-server.js --reconfigure"
echo
node chat-server.js "$@"

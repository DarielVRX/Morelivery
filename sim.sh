#!/bin/bash
# Abre el simulador en el navegador automáticamente
# Uso: ./sim.sh [puerto]

PORT=${1:-5173}
URL="http://localhost:$PORT/sim"

cd "$(dirname "$0")/frontend" || exit 1

# Verificar si ya hay un servidor corriendo
if curl -s "http://localhost:$PORT" > /dev/null 2>&1; then
  echo "✓ Servidor ya corriendo en puerto $PORT"
else
  echo "▶ Iniciando servidor de desarrollo..."
  npm run dev -- --port "$PORT" &
  # Esperar a que el servidor esté listo
  echo -n "Esperando servidor"
  for i in $(seq 1 30); do
    sleep 1
    echo -n "."
    if curl -s "http://localhost:$PORT" > /dev/null 2>&1; then
      echo " listo"
      break
    fi
  done
fi

echo "🌐 Abriendo $URL"

# Abrir en el navegador según el OS
if command -v xdg-open > /dev/null 2>&1; then
  xdg-open "$URL"
elif command -v open > /dev/null 2>&1; then
  open "$URL"
elif command -v start > /dev/null 2>&1; then
  start "$URL"
else
  echo "Abre manualmente: $URL"
fi

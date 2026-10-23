#!/bin/sh
# Altera a rota padrão de abertura de /album para /song
# No Navidrome, isso geralmente está no App.jsx ou index.jsx da UI
sed -i 's|to="/album"|to="/song"|g' /src/ui/src/App.jsx 2>/dev/null || true
sed -i 's|to="/album"|to="/song"|g' /src/ui/src/index.jsx 2>/dev/null || true
sed -i 's|path="/"|path="/song"|g' /src/ui/src/App.jsx 2>/dev/null || true

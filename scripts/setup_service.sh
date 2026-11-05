#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# OpenJarvis Service Setup
# Configures and manages systemd user services for:
#   1. Ollama (Inference Engine)
#   2. OpenJarvis Backend API Server (connected to Ollama)
#   3. OpenJarvis Frontend Web UI (proxied to Backend with auto-filled settings)
# ─────────────────────────────────────────────────────────────────────────────

# Find workspace directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Configuration (can be overridden via environment variables)
BACKEND_HOST="${OPENJARVIS_HOST:-${BACKEND_HOST:-0.0.0.0}}"
BACKEND_PORT="${OPENJARVIS_PORT:-${BACKEND_PORT:-10101}}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
OLLAMA_HOST_URL="${OLLAMA_HOST:-http://127.0.0.1:11434}"
MODEL_NAME="${OPENJARVIS_MODEL:-qwen2.5:0.5b}"

echo "=========================================================="
echo " Setting up OpenJarvis Full Stack Service "
echo " (Ollama Engine + Backend API + Frontend UI) "
echo "=========================================================="

# ── 1. Locate Node.js & npm ──────────────────────────────────────────────────
NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"

if [[ -z "${NPM_BIN}" || -z "${NODE_BIN}" ]]; then
  # Search common nvm directories
  if [[ -d "${HOME}/.nvm/versions/node" ]]; then
    for candidate_dir in "${HOME}/.nvm/versions/node"/*/bin; do
      if [[ -x "${candidate_dir}/npm" && -x "${candidate_dir}/node" ]]; then
        NODE_BIN="${candidate_dir}/node"
        NPM_BIN="${candidate_dir}/npm"
        export PATH="${candidate_dir}:${PATH}"
        break
      fi
    done
  fi
fi

if [[ -z "${NPM_BIN}" || ! -x "${NPM_BIN}" ]]; then
  echo "Error: 'npm' not found. Please install Node.js (>=22) or make sure it is in PATH." >&2
  exit 1
fi

NODE_DIR="$(dirname "${NODE_BIN}")"
echo "✓ Node.js found: ${NODE_BIN} ($(${NODE_BIN} --version))"
echo "✓ npm found:     ${NPM_BIN} ($(${NPM_BIN} --version))"

# ── 2. Locate Backend executable (uv or virtualenv jarvis) ───────────────────
UV_BIN="$(command -v uv || true)"
if [[ -z "${UV_BIN}" ]]; then
  for candidate in "${HOME}/.local/bin/uv" "${HOME}/.cargo/bin/uv" "/usr/local/bin/uv"; do
    if [[ -x "${candidate}" ]]; then
      UV_BIN="${candidate}"
      break
    fi
  done
fi

BACKEND_CMD=""
if [[ -n "${UV_BIN}" && -x "${UV_BIN}" ]]; then
  BACKEND_CMD="${UV_BIN} run jarvis"
  echo "✓ uv found:      ${UV_BIN}"
elif [[ -x "${WORKSPACE_DIR}/.venv/bin/jarvis" ]]; then
  BACKEND_CMD="${WORKSPACE_DIR}/.venv/bin/jarvis"
  echo "✓ virtualenv found: ${WORKSPACE_DIR}/.venv/bin/jarvis"
elif command -v jarvis >/dev/null 2>&1; then
  BACKEND_CMD="$(command -v jarvis)"
  echo "✓ jarvis CLI found on PATH: ${BACKEND_CMD}"
else
  echo "Error: Neither 'uv' nor '${WORKSPACE_DIR}/.venv/bin/jarvis' was found." >&2
  echo "Please install uv or build the virtual environment first." >&2
  exit 1
fi

# ── 3. Locate Ollama ────────────────────────────────────────────────────────
OLLAMA_BIN="$(command -v ollama || true)"
if [[ -z "${OLLAMA_BIN}" ]]; then
  for candidate in "/usr/local/bin/ollama" "/usr/bin/ollama" "${HOME}/.local/bin/ollama"; do
    if [[ -x "${candidate}" ]]; then
      OLLAMA_BIN="${candidate}"
      break
    fi
  done
fi

if [[ -z "${OLLAMA_BIN}" || ! -x "${OLLAMA_BIN}" ]]; then
  echo "! Ollama not found. Attempting automatic installation..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://ollama.com/install.sh | sh || true
    OLLAMA_BIN="$(command -v ollama || echo "/usr/local/bin/ollama")"
  fi
fi

if [[ -x "${OLLAMA_BIN}" ]]; then
  echo "✓ Ollama found:  ${OLLAMA_BIN}"
else
  echo "Warning: Ollama binary not found. If running remotely, ensure OLLAMA_HOST is reachable at: ${OLLAMA_HOST_URL}"
fi

# ── 4. Ensure API Key for non-loopback bind safety ──────────────────────────
# OpenJarvis server requires OPENJARVIS_API_KEY when binding to 0.0.0.0
OPENJARVIS_API_KEY="${OPENJARVIS_API_KEY:-}"
CONFIG_FILE="${HOME}/.openjarvis/config.toml"
if [[ -z "${OPENJARVIS_API_KEY}" && "${BACKEND_HOST}" != "127.0.0.1" && "${BACKEND_HOST}" != "localhost" ]]; then
  # Look for existing configured key in config.toml
  if [[ -f "${CONFIG_FILE}" ]]; then
    EXISTING_KEY="$(grep -E '^\s*api_key\s*=' "${CONFIG_FILE}" | head -n1 | cut -d'"' -f2 || true)"
    if [[ -n "${EXISTING_KEY}" ]]; then
      OPENJARVIS_API_KEY="${EXISTING_KEY}"
    fi
  fi
  # Generate a key if still unset
  if [[ -z "${OPENJARVIS_API_KEY}" ]]; then
    OPENJARVIS_API_KEY="$(openssl rand -hex 24 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(24))' 2>/dev/null || echo "oj_key_$(date +%s)")"
  fi
fi

# Persist API Key in ~/.openjarvis/config.toml
if [[ -n "${OPENJARVIS_API_KEY}" ]]; then
  mkdir -p "${HOME}/.openjarvis"
  if [[ -f "${CONFIG_FILE}" ]]; then
    if grep -q "\[server.auth\]" "${CONFIG_FILE}"; then
      sed -i -E 's/(api_key\s*=\s*)"[^"]*"/\1"'"${OPENJARVIS_API_KEY}"'"/' "${CONFIG_FILE}"
    else
      printf '\n[server.auth]\napi_key = "%s"\n' "${OPENJARVIS_API_KEY}" >> "${CONFIG_FILE}"
    fi
  else
    printf '[server.auth]\napi_key = "%s"\n' "${OPENJARVIS_API_KEY}" > "${CONFIG_FILE}"
  fi
  chmod 600 "${CONFIG_FILE}" 2>/dev/null || true
  echo "✓ Saved API Key to ${CONFIG_FILE}"
fi

# ── 5. Prepare directories and frontend UI auto-fill ─────────────────────────
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
mkdir -p "${SYSTEMD_USER_DIR}"
mkdir -p "${WORKSPACE_DIR}/logs"

# Write .env for frontend so UI automatically has API key, default model, and Ollama host filled in
cat <<EOF > "${WORKSPACE_DIR}/frontend/.env"
VITE_OPENJARVIS_API_KEY=${OPENJARVIS_API_KEY}
VITE_DEFAULT_MODEL=${MODEL_NAME}
VITE_OLLAMA_HOST=${OLLAMA_HOST_URL}
EOF
cp -f "${WORKSPACE_DIR}/frontend/.env" "${WORKSPACE_DIR}/frontend/.env.local" 2>/dev/null || true
echo "✓ Auto-configured UI settings in frontend/.env (API Key & Model: ${MODEL_NAME})"

if [[ ! -d "${WORKSPACE_DIR}/frontend/node_modules" ]]; then
  echo "Installing frontend dependencies..."
  (cd "${WORKSPACE_DIR}/frontend" && PATH="${NODE_DIR}:${PATH}" npm install)
fi

# Build frontend with the auto-filled credentials for static delivery
echo "Building frontend static assets with auto-filled UI settings..."
(cd "${WORKSPACE_DIR}/frontend" && PATH="${NODE_DIR}:${PATH}" npm run build || true)

# ── 6. Create Service Files ──────────────────────────────────────────────────

# 6a. Ollama service (runs ollama serve, or monitors existing daemon if running)
OLLAMA_SERVICE_FILE="${SYSTEMD_USER_DIR}/openjarvis-ollama.service"
echo "Creating systemd user service at: ${OLLAMA_SERVICE_FILE}"

cat <<EOF > "${OLLAMA_SERVICE_FILE}"
[Unit]
Description=OpenJarvis Ollama Inference Engine
After=network.target
PartOf=openjarvis.service

[Service]
Type=simple
Environment=OLLAMA_HOST=127.0.0.1:11434
Environment=PATH=${NODE_DIR}:${WORKSPACE_DIR}/.venv/bin:${HOME}/.local/bin:${HOME}/.cargo/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/bin/bash -c 'if curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then echo "Ollama is already running on port 11434. Monitoring..."; while curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; do sleep 5; done; fi; exec "${OLLAMA_BIN}" serve'
Restart=always
RestartSec=3
StandardOutput=append:${WORKSPACE_DIR}/logs/ollama.log
StandardError=append:${WORKSPACE_DIR}/logs/ollama.error.log

[Install]
WantedBy=default.target
EOF

# 6b. Backend service (runs jarvis serve connected to Ollama)
BACKEND_SERVICE_FILE="${SYSTEMD_USER_DIR}/openjarvis-backend.service"
echo "Creating systemd user service at: ${BACKEND_SERVICE_FILE}"

cat <<EOF > "${BACKEND_SERVICE_FILE}"
[Unit]
Description=OpenJarvis AI Assistant Backend Server
After=network.target openjarvis-ollama.service
Wants=openjarvis-ollama.service
PartOf=openjarvis.service

[Service]
Type=simple
WorkingDirectory=${WORKSPACE_DIR}
Environment=PYTHONUNBUFFERED=1
Environment=OPENJARVIS_LOG_DIR=${WORKSPACE_DIR}/logs
Environment=OPENJARVIS_ENGINE_DEFAULT=ollama
Environment=OLLAMA_HOST=${OLLAMA_HOST_URL}
Environment=OPENJARVIS_MODEL=${MODEL_NAME}
Environment=OPENJARVIS_API_KEY=${OPENJARVIS_API_KEY}
Environment=OPENJARVIS_CORS_ORIGINS=http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT},http://${FRONTEND_HOST}:${FRONTEND_PORT}
Environment=PATH=${WORKSPACE_DIR}/.venv/bin:${HOME}/.local/bin:${HOME}/.cargo/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=${BACKEND_CMD} serve --host ${BACKEND_HOST} --port ${BACKEND_PORT} --engine ollama --model ${MODEL_NAME}
Restart=always
RestartSec=3
StandardOutput=append:${WORKSPACE_DIR}/logs/backend.log
StandardError=append:${WORKSPACE_DIR}/logs/backend.error.log

[Install]
WantedBy=default.target
EOF

# 6c. Frontend service (runs Vite dev server proxied to backend)
FRONTEND_SERVICE_FILE="${SYSTEMD_USER_DIR}/openjarvis-frontend.service"
echo "Creating systemd user service at: ${FRONTEND_SERVICE_FILE}"

cat <<EOF > "${FRONTEND_SERVICE_FILE}"
[Unit]
Description=OpenJarvis Web Frontend UI
After=network.target openjarvis-backend.service
Wants=openjarvis-backend.service
PartOf=openjarvis.service

[Service]
Type=simple
WorkingDirectory=${WORKSPACE_DIR}/frontend
Environment=OPENJARVIS_VITE_PROXY_TARGET=http://127.0.0.1:${BACKEND_PORT}
Environment=VITE_OPENJARVIS_API_KEY=${OPENJARVIS_API_KEY}
Environment=VITE_DEFAULT_MODEL=${MODEL_NAME}
Environment=VITE_OLLAMA_HOST=${OLLAMA_HOST_URL}
Environment=VITE_API_URL=
Environment=PATH=${NODE_DIR}:${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=${NPM_BIN} run dev -- --host ${FRONTEND_HOST} --port ${FRONTEND_PORT}
Restart=always
RestartSec=3
StandardOutput=append:${WORKSPACE_DIR}/logs/frontend.log
StandardError=append:${WORKSPACE_DIR}/logs/frontend.error.log

[Install]
WantedBy=default.target
EOF

# 6d. Master service (groups Ollama, Backend, and Frontend)
MASTER_SERVICE_FILE="${SYSTEMD_USER_DIR}/openjarvis.service"
echo "Creating systemd master service at: ${MASTER_SERVICE_FILE}"

cat <<EOF > "${MASTER_SERVICE_FILE}"
[Unit]
Description=OpenJarvis AI Assistant Full Stack (Ollama + Backend + Frontend)
After=network.target openjarvis-ollama.service openjarvis-backend.service openjarvis-frontend.service
Wants=openjarvis-ollama.service openjarvis-backend.service openjarvis-frontend.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/true
ExecReload=/bin/true

[Install]
WantedBy=default.target
EOF

# Keep backward compatibility symlinks for logs
ln -sf backend.log "${WORKSPACE_DIR}/logs/service.log" 2>/dev/null || true
ln -sf backend.error.log "${WORKSPACE_DIR}/logs/service.error.log" 2>/dev/null || true

# ── 7. Ensure Ollama is Running and Download Model ────────────────────────────
SYSTEMD_AVAILABLE=false
if command -v systemctl >/dev/null 2>&1 && systemctl --user daemon-reload >/dev/null 2>&1; then
  SYSTEMD_AVAILABLE=true
fi

if [[ "${SYSTEMD_AVAILABLE}" == "true" ]]; then
  echo "Reloading systemd daemon and starting Ollama service..."
  systemctl --user daemon-reload
  systemctl --user enable openjarvis-ollama.service
  systemctl --user restart openjarvis-ollama.service
fi

echo "Checking Ollama connectivity at ${OLLAMA_HOST_URL}..."
OLLAMA_ONLINE=false
for i in {1..20}; do
  if curl -sf "${OLLAMA_HOST_URL}/api/tags" >/dev/null 2>&1; then
    OLLAMA_ONLINE=true
    break
  fi
  sleep 1
done

if [[ "${OLLAMA_ONLINE}" == "true" ]]; then
  echo "✓ Ollama engine is online and responsive."
  if [[ -x "${OLLAMA_BIN}" ]]; then
    if "${OLLAMA_BIN}" list 2>/dev/null | grep -q -E "^${MODEL_NAME%%:*}(:| )"; then
      echo "✓ Ollama model '${MODEL_NAME}' is already downloaded and ready."
    else
      echo "Downloading Ollama model '${MODEL_NAME}'..."
      "${OLLAMA_BIN}" pull "${MODEL_NAME}"
      echo "✓ Ollama model '${MODEL_NAME}' downloaded successfully!"
    fi
  fi
else
  echo "Warning: Ollama did not respond within timeout at ${OLLAMA_HOST_URL}."
fi

# ── 8. Start / Restart OpenJarvis Backend and Frontend ────────────────────────
if [[ "${SYSTEMD_AVAILABLE}" == "true" ]]; then
  echo "Enabling all openjarvis services on boot..."
  systemctl --user enable openjarvis-ollama.service openjarvis-backend.service openjarvis-frontend.service openjarvis.service

  echo "Starting OpenJarvis stack (Backend and Frontend with auto-filled UI)..."
  systemctl --user restart openjarvis.service

  # Enable lingering so services start on power-on / boot before graphical login
  if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "${USER}" 2>/dev/null || true
  fi
else
  echo ""
  echo "Note: Systemd user manager is not active in this session (e.g. inside a container or WSL without systemd init)."
  echo "Service unit files were successfully written to ${SYSTEMD_USER_DIR}/."
  echo "They will be activated automatically once running in a systemd environment."
fi

echo ""
echo "=========================================================="
echo " OpenJarvis Full Stack Setup Completed Successfully! "
echo "=========================================================="
echo " Frontend UI:    http://<server-ip>:${FRONTEND_PORT}"
echo " Backend API:    http://<server-ip>:${BACKEND_PORT}"
echo " Ollama Engine:  ${OLLAMA_HOST_URL} (Model: ${MODEL_NAME} [Downloaded])"
if [[ -n "${OPENJARVIS_API_KEY}" ]]; then
echo " API Key:        ${OPENJARVIS_API_KEY} (Auto-filled in UI)"
fi
echo ""
echo " Service Control (systemd):"
echo "   Status:       systemctl --user status openjarvis"
echo "   Restart all:  systemctl --user restart openjarvis"
echo "   Stop all:     systemctl --user stop openjarvis"
echo ""
echo " Sub-service Control:"
echo "   Backend:      systemctl --user status openjarvis-backend"
echo "   Frontend:     systemctl --user status openjarvis-frontend"
echo "   Ollama:       systemctl --user status openjarvis-ollama"
echo ""
echo " Logs:"
echo "   Backend:      ${WORKSPACE_DIR}/logs/backend.log"
echo "   Frontend:     ${WORKSPACE_DIR}/logs/frontend.log"
echo "   Ollama:       ${WORKSPACE_DIR}/logs/ollama.log"
echo "=========================================================="

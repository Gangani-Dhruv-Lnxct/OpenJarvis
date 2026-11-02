#!/usr/bin/env bash
set -euo pipefail

# Find workspace directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Find uv binary
UV_BIN="$(command -v uv || echo "${HOME}/.local/bin/uv")"

if [[ ! -x "${UV_BIN}" ]]; then
  echo "Error: 'uv' not found. Please install uv or make sure it is in PATH." >&2
  exit 1
fi

SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
mkdir -p "${SYSTEMD_USER_DIR}"
mkdir -p "${WORKSPACE_DIR}/logs"

SERVICE_FILE="${SYSTEMD_USER_DIR}/openjarvis.service"

echo "Creating systemd user service at: ${SERVICE_FILE}"

cat <<EOF > "${SERVICE_FILE}"
[Unit]
Description=OpenJarvis AI Assistant Server
After=network.target

[Service]
Type=simple
WorkingDirectory=${WORKSPACE_DIR}
ExecStart=${UV_BIN} run jarvis serve --host 127.0.0.1 --port 10101
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1
Environment=OPENJARVIS_LOG_DIR=${WORKSPACE_DIR}/logs
StandardOutput=append:${WORKSPACE_DIR}/logs/service.log
StandardError=append:${WORKSPACE_DIR}/logs/service.error.log

[Install]
WantedBy=default.target
EOF

echo "Reloading systemd daemon..."
systemctl --user daemon-reload

echo "Enabling openjarvis service on boot..."
systemctl --user enable openjarvis.service

echo "Starting openjarvis service..."
systemctl --user restart openjarvis.service

# Enable lingering so service starts on power-on / boot before graphical login
if command -v loginctl >/dev/null 2>&1; then
  loginctl enable-linger "${USER}" 2>/dev/null || true
fi

echo ""
echo "=========================================================="
echo " OpenJarvis Background Service Installed Successfully! "
echo "=========================================================="
echo " Status:   systemctl --user status openjarvis"
echo " Logs:     ${WORKSPACE_DIR}/logs/ (server.log, service.log, error.log)"
echo " Restart:  systemctl --user restart openjarvis"
echo " Stop:     systemctl --user stop openjarvis"
echo " URL:      http://127.0.0.1:10101"
echo "=========================================================="

#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}Starting Magic Mirror Orange Pi Installation...${NC}"

# 1. Install System Dependencies & Kiosk Tools
echo -e "Installing system dependencies (Node.js, gpiod, NetworkManager, Bluetooth, Webcam, Chromium, unclutter)..."
sudo apt-get update
sudo apt-get install -y nodejs npm gpiod network-manager bluetooth bluez libbluetooth-dev fswebcam v4l-utils chromium unclutter cpufrequtils || sudo apt-get install -y nodejs npm network-manager bluetooth bluez libbluetooth-dev fswebcam v4l-utils chromium unclutter cpufrequtils

# 2. Setup Polkit for NetworkManager (so Node.js can use nmcli without sudo)
echo -e "Configuring Polkit permissions for NetworkManager..."
USER_NAME=$(whoami)
POLKIT_FILE="/etc/polkit-1/localauthority/50-local.d/magic-mirror.pkla"
sudo mkdir -p /etc/polkit-1/localauthority/50-local.d/

sudo bash -c "cat > $POLKIT_FILE" <<EOF
[Magic Mirror Network Control]
Identity=unix-user:$USER_NAME
Action=org.freedesktop.NetworkManager.network-control;org.freedesktop.NetworkManager.settings.modify.system;org.freedesktop.NetworkManager.settings.modify.own;org.freedesktop.NetworkManager.wifi.share.open;org.freedesktop.NetworkManager.wifi.share.protected;org.freedesktop.NetworkManager.enable-disable-wifi
ResultAny=yes
ResultInactive=yes
ResultActive=yes
EOF

# 3. Setup Hardware Permissions (GPIO & Framebuffer)
echo -e "Configuring Hardware permissions..."
# Adding user to groups
sudo usermod -aG gpio,video $USER_NAME 2>/dev/null || echo "Groups not found, skipping..."

# Creating UDEV rules for GPIO and Framebuffer without sudo
UDEV_RULES_FILE="/etc/udev/rules.d/99-magic-mirror.rules"
sudo bash -c "cat > $UDEV_RULES_FILE" <<EOF
SUBSYSTEM=="gpio", KERNEL=="gpiochip*", GROUP="gpio", MODE="0660"
SUBSYSTEM=="graphics", KERNEL=="fb0", GROUP="video", MODE="0660"
EOF

sudo udevadm control --reload-rules && sudo udevadm trigger

# 4. CPU Governor & Performance Tuning (Allwinner SoC)
echo -e "Configuring CPU Governor (Performance/Schedutil) for smooth rendering..."
if [ -f /etc/default/cpufrequtils ]; then
  sudo bash -c "echo 'GOVERNOR=\"performance\"' > /etc/default/cpufrequtils"
  sudo systemctl restart cpufrequtils 2>/dev/null || true
fi
# Apply governor directly if sysfs path exists
for cpu_gov in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
  if [ -f "$cpu_gov" ]; then
    echo "performance" | sudo tee "$cpu_gov" > /dev/null 2>&1 || true
  fi
done

# Make kiosk script executable
chmod +x scripts/start_kiosk.sh 2>/dev/null || true

# 5. Install Project Dependencies
echo -e "Installing Node.js project dependencies..."
npm install

# 6. Setup Systemd Service
echo -e "Setting up Systemd service..."
INSTALL_DIR=$(pwd)
USER_NAME=$(whoami)
NODE_BIN=$(which node || echo /usr/bin/node)

cat > /tmp/magic-mirror.service <<EOF
[Unit]
Description=Magic Mirror Orange Pi Server
After=network.target NetworkManager.service

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_BIN $INSTALL_DIR/server/src/start.js
Restart=on-failure
Nice=-5
Environment="NODE_OPTIONS=--max-old-space-size=512"
EnvironmentFile=-$INSTALL_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

sudo cp /tmp/magic-mirror.service /etc/systemd/system/magic-mirror.service
sudo systemctl daemon-reload
sudo systemctl enable magic-mirror.service

# 7. Setup Chromium Kiosk Autostart for Graphical Desktop
echo -e "Configuring automatic Kiosk display on system boot..."
AUTOSTART_DIR="$HOME/.config/autostart"
mkdir -p "$AUTOSTART_DIR"
cat > "$AUTOSTART_DIR/magic-mirror-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Magic Mirror Kiosk
Exec=$INSTALL_DIR/scripts/start_kiosk.sh
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
EOF

echo -e "${GREEN}Installation & Optimization complete!${NC}"
echo -e "✓ Сервер включен в автозапуск (systemd)."
echo -e "✓ Экран Kiosk настроен на автозапуск при входе в систему."
echo -e "1. Запуск сервера сейчас: 'sudo systemctl start magic-mirror.service'"
echo -e "2. Запуск экрана сейчас:  './scripts/start_kiosk.sh'"
echo -e "Логи сервера: 'journalctl -u magic-mirror.service -f'"

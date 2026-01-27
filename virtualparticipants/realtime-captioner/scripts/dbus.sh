#!/bin/bash

set -eou pipefail

export DISPLAY=${DISPLAY:-:99}
export LIBGL_ALWAYS_INDIRECT=1
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus

mkdir -p $XDG_RUNTIME_DIR
chmod 700 $XDG_RUNTIME_DIR

# Start the D-Bus system daemon
if [ ! -e /var/run/dbus/system_bus_socket ]; then
  dbus-daemon --system --fork &> /dev/null &
fi

# Start the D-Bus session daemon
if [ ! -e "$XDG_RUNTIME_DIR/bus" ]; then
  dbus-daemon --session --address=$DBUS_SESSION_BUS_ADDRESS --nofork --nopidfile --syslog-only &
fi

# Wait for the session bus to be ready
until dbus-send --session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames > /dev/null 2>&1; do
  echo "Waiting for D-Bus session bus..."
  sleep 1
done

echo "D-Bus session bus is ready."
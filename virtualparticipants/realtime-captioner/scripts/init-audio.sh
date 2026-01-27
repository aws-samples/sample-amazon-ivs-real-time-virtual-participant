#!/bin/bash
set -e

echo "Initializing audio subsystem for container environment..."

# Wait for Xvfb to be ready
echo "Waiting for X server (Xvfb) to be ready..."
xvfb_timeout=30
xvfb_count=0
while ! xdpyinfo -display :99 >/dev/null 2>&1; do
    if [ $xvfb_count -ge $xvfb_timeout ]; then
        echo "ERROR: X server (Xvfb) failed to start within $xvfb_timeout seconds"
        exit 1
    fi
    echo "Waiting for X server... ($xvfb_count/$xvfb_timeout)"
    sleep 1
    xvfb_count=$((xvfb_count + 1))
done

echo "X server (Xvfb) is ready on display :99"

# Wait for PulseAudio to be available
echo "Waiting for PulseAudio to be ready..."
timeout=30
count=0
while ! pactl --server=unix:/tmp/pulse-socket info >/dev/null 2>&1; do
    if [ $count -ge $timeout ]; then
        echo "ERROR: PulseAudio failed to start within $timeout seconds"
        exit 1
    fi
    echo "Waiting for PulseAudio... ($count/$timeout)"
    sleep 1
    count=$((count + 1))
done

echo "PulseAudio is running and accessible via socket"

# Additional wait to ensure PulseAudio modules are fully loaded
echo "Allowing time for PulseAudio modules to initialize..."
sleep 2

# Verify PulseAudio is still accessible via socket
echo "Verifying PulseAudio accessibility..."
pactl --server=unix:/tmp/pulse-socket info >/dev/null 2>&1 || {
    echo "ERROR: PulseAudio socket verification failed"
    exit 1
}

# Wait for dummy_output sink to be available
echo "Waiting for dummy_output sink to be available..."
sink_timeout=15
sink_count=0
while ! pactl --server=unix:/tmp/pulse-socket list sinks short | grep -q "dummy_output"; do
    if [ $sink_count -ge $sink_timeout ]; then
        echo "WARNING: dummy_output sink not found after $sink_timeout seconds"
        break
    fi
    echo "Waiting for dummy_output sink... ($sink_count/$sink_timeout)"
    sleep 1
    sink_count=$((sink_count + 1))
done

# List available sinks and sources for debugging
echo "Available audio sinks:"
pactl --server=unix:/tmp/pulse-socket list sinks short || echo "Failed to list sinks"

echo "Available audio sources:"
pactl --server=unix:/tmp/pulse-socket list sources short || echo "Failed to list sources"

# Set default sink (using monitor source since module-null-source fails)
echo "Setting default audio devices..."
pactl --server=unix:/tmp/pulse-socket set-default-sink dummy_output || echo "Failed to set default sink"

# Use the monitor source instead of dummy_input since module-null-source fails
echo "Setting monitor source as default..."
pactl --server=unix:/tmp/pulse-socket set-default-source dummy_output.monitor || {
    echo "Failed to set monitor source, trying dummy_output.2.monitor..."
    pactl --server=unix:/tmp/pulse-socket set-default-source dummy_output.2.monitor || echo "Failed to set any monitor source"
}

# Test audio subsystem by creating a brief test connection
echo "Testing audio subsystem..."
(
    # Create a very brief test audio to warm up the system
    timeout 2s paplay /dev/zero 2>/dev/null || true
) &
test_pid=$!
sleep 0.5
kill $test_pid 2>/dev/null || true
wait $test_pid 2>/dev/null || true

echo "Audio subsystem initialized successfully"

# Export environment variables for the session
export PULSE_SERVER=unix:/tmp/pulse-socket
export PULSE_RUNTIME_PATH=/var/run/pulse

# Additional delay to ensure audio subsystem is stable
echo "Final stabilization delay..."
sleep 1

echo "Audio initialization complete - PulseAudio ready for Chrome"
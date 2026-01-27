FROM public.ecr.aws/docker/library/node:lts-iron

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
ENV SUPERVISOR_CONF_PATH=/etc/supervisor/conf.d/supervisord.conf

# dbus
RUN apt-get update && apt-get install -y dbus dbus-x11 upower

# pulseaudio for container audio support
RUN apt-get update && apt-get install -y \
    pulseaudio \
    pulseaudio-utils \
    alsa-utils \
    libasound2-plugins \
    && rm -rf /var/lib/apt/lists/*

# xvfb for virtual display (needed for non-headless Chrome with SODA)
RUN apt-get update && apt-get install -y \
    xvfb \
    x11-utils \
    && rm -rf /var/lib/apt/lists/*

# Create pulse directories and copy configurations
RUN mkdir -p /etc/pulse /var/lib/pulse /var/run/pulse
COPY realtime-captioner/pulse/daemon.conf /etc/pulse/daemon.conf
COPY realtime-captioner/pulse/system.pa /etc/pulse/system.pa
RUN chmod +x /etc/pulse/system.pa

# Set up pulse environment variables
ENV PULSE_SERVER=unix:/tmp/pulse-socket
ENV PULSE_RUNTIME_PATH=/var/run/pulse

# Set up X server display for non-headless Chrome
ENV DISPLAY=:99

# supervisor
RUN apt-get update && apt-get install supervisor -y && mkdir -p /var/log/supervisor
COPY realtime-captioner/supervisor/ /etc/supervisor/
RUN chmod +x /etc/supervisor/kill_supervisor.sh

# cpufrequtils
RUN apt-get update && apt-get install -y cpufrequtils
COPY realtime-captioner/cpufrequtils /etc/default/cpufrequtils
COPY realtime-captioner/cpufrequtils /etc/init.d/cpufrequtils

# google-chrome-stable
RUN apt-get update && apt-get install gnupg wget -y \
  && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /etc/apt/trusted.gpg.d/google-archive.gpg \
  && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list'
RUN apt-get update && apt-get install google-chrome-stable -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /home/virtualparticipant

# First, copy and build the common module
COPY common/package*.json ./common/
WORKDIR /home/virtualparticipant/common
RUN npm ci --cache .npm --prefer-offline
COPY common/ ./
RUN npm run build

# Now copy and build the realtime-captioner module
WORKDIR /home/virtualparticipant/realtime-captioner
COPY realtime-captioner/package*.json ./
RUN npm ci --cache .npm --prefer-offline

# Copy all realtime-captioner files
COPY realtime-captioner/ ./

# Make scripts executable
RUN chmod +x scripts/dbus.sh scripts/init-audio.sh

# Install global packages and build
RUN npm i -g --cache .npm --prefer-offline serve tsx
RUN npm run build

# Set working directory back to realtime-captioner for runtime
WORKDIR /home/virtualparticipant/realtime-captioner

EXPOSE 80 3001

CMD ["/bin/sh", "-c", "exec /usr/bin/supervisord -c $SUPERVISOR_CONF_PATH"]

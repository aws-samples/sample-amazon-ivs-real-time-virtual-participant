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

# Create pulse directories and copy configurations
RUN mkdir -p /etc/pulse /var/lib/pulse /var/run/pulse
COPY gpt-realtime/pulse/daemon.conf /etc/pulse/daemon.conf
COPY gpt-realtime/pulse/system.pa /etc/pulse/system.pa
RUN chmod +x /etc/pulse/system.pa

# Set up pulse environment variables
ENV PULSE_SERVER=unix:/tmp/pulse-socket
ENV PULSE_RUNTIME_PATH=/var/run/pulse

# supervisor
RUN apt-get update && apt-get install supervisor -y && mkdir -p /var/log/supervisor
COPY gpt-realtime/supervisor/ /etc/supervisor/

# cpufrequtils
RUN apt-get update && apt-get install -y cpufrequtils
COPY gpt-realtime/cpufrequtils /etc/default/cpufrequtils
COPY gpt-realtime/cpufrequtils /etc/init.d/cpufrequtils

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

# Now copy and build the gpt-realtime module
WORKDIR /home/virtualparticipant/gpt-realtime
COPY gpt-realtime/package*.json ./
RUN npm ci --cache .npm --prefer-offline

# Copy all gpt-realtime files
COPY gpt-realtime/ ./

# Make scripts executable
RUN chmod +x scripts/init-audio.sh scripts/dbus.sh

# Install global packages and build
RUN npm i -g --cache .npm --prefer-offline serve tsx
RUN npm run build

# Set working directory back to gpt-realtime for runtime
WORKDIR /home/virtualparticipant/gpt-realtime

EXPOSE 80 3001

CMD ["/bin/sh", "-c", "exec /usr/bin/supervisord -c $SUPERVISOR_CONF_PATH"]

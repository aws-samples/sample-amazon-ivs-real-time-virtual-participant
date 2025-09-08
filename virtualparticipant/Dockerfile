FROM public.ecr.aws/docker/library/node:lts-iron

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
ENV SUPERVISOR_CONF_PATH=/etc/supervisor/conf.d/supervisord.conf

# dbus
RUN apt-get update && apt-get install -y dbus dbus-x11 upower

# supervisor
RUN apt-get update && apt-get install supervisor -y && mkdir -p /var/log/supervisor
COPY supervisor/ /etc/supervisor/

# cpufrequtils
RUN apt-get update && apt-get install -y cpufrequtils
COPY cpufrequtils /etc/default/cpufrequtils
COPY cpufrequtils /etc/init.d/cpufrequtils

# google-chrome-stable
RUN apt-get update && apt-get install gnupg wget -y \
  && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /etc/apt/trusted.gpg.d/google-archive.gpg \
  && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list'
RUN apt-get update && apt-get install google-chrome-stable -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /home/virtualparticipant
COPY . .

RUN npm i -g --cache .npm --prefer-offline serve tsx
RUN npm ci --cache .npm --prefer-offline
RUN npm run build

EXPOSE 80 3001

CMD ["/bin/sh", "-c", "exec /usr/bin/supervisord -c $SUPERVISOR_CONF_PATH"]

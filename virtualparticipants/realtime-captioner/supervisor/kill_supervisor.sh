#!/bin/bash

set -eou pipefail

# Tell supervisor we're ready to receive events
printf "READY\n";

while read line; do
  echo "[kill_supervisor.sh] Incoming supervisor event: $line" >&2;
  # Kill supervisor (will stop the container)
  kill -3 $(cat "./supervisord.pid")
done < /dev/stdin
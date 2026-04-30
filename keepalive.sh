#!/bin/bash
cd /home/z/my-project
while true; do
    bun run dev 2>&1
    echo "[keepalive] Restarting in 2s... $(date)" >> /home/z/my-project/dev.log
    sleep 2
done

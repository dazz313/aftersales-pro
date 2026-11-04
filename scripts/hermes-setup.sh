#!/bin/bash
cd /home/dazz/aftersales-pro
HERMES_UID=1000 HERMES_GID=1000 docker compose -f docker-compose.hermes.yml run --rm hermes setup

#!/usr/bin/env bash

docker buildx create --use
docker buildx inspect --bootstrap
docker buildx build --platform linux/arm/v7 -t tsr-notifier -o type=docker,dest=- . > tsr-notifier.tar

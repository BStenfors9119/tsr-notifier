#!/usr/bin/env bash

#docker buildx create --use
#docker buildx inspect --bootstrap
podman build --platform linux/arm/v7 -t tsr-notifier .
podman save --format docker-archive -o tsr-notifier.tar tsr-notifier

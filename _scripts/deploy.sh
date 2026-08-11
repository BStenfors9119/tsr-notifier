#!/usr/bin/env bash
# Build the tsr-notifier Docker image from the working tree and (re)launch the
# container. Mirrors pwa/deploy.sh — meant to be run ON the docker server
# (10.24.3.46), where the build is NATIVE (arm/v7), so there's no QEMU/buildx
# cross-compile step and no image tar to ship. Pull the notifier repo down to
# the server and run this from there.
#
# Usage: ./deploy.sh <major|minor|patch>   (run from anywhere)
#        bash deploy.sh patch
#
# Unlike the PWA, the notifier is a HEADLESS worker (node-schedule + FCM push,
# no HTTP server) — so there's no published port and no URL to open. The
# version bump just tags the image (tsr-notifier:<version>) so each deploy is
# identifiable and rollback is possible.
#
# Assumes Docker is installed and the invoking user can run it (docker group
# or sudo). Safe to re-run — the existing container is stopped and removed first.

set -euo pipefail

IMAGE_NAME="tsr-notifier"
CONTAINER_NAME="tsr-notifier"

# Operate from the notifier root (this script lives in _scripts/), so the
# Dockerfile, package.json, and the build context are all in the cwd below.
cd "$(dirname "$0")/.."

# ---- arg validation ---------------------------------------------------------
# Case-insensitive so MAJOR / Minor / patch all work.
BUMP="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')"
case "${BUMP}" in
    major|minor|patch) ;;
    *)
        echo "Usage: $0 <major|minor|patch>" >&2
        echo "  Bumps package.json's version, then builds and (re)deploys." >&2
        exit 1
        ;;
esac

# ---- preflight: the runtime secret must be in the build context -------------
# index.js does `require('./firebase-account-key.json')`, and the Dockerfile
# COPYs it into the image. It's gitignored, so a fresh clone on the server
# WON'T have it — and Docker honours .dockerignore, not .gitignore, so the
# image would build fine and then crash-loop at startup with MODULE_NOT_FOUND.
# Fail loud and early instead.
if [ ! -f firebase-account-key.json ]; then
    echo "ERROR: firebase-account-key.json is missing from $(pwd)." >&2
    echo "       It's a gitignored secret and is not in the repo — copy it onto" >&2
    echo "       the server (e.g. scp it here) before building." >&2
    exit 1
fi

# ---- version bump -----------------------------------------------------------
# --no-git-tag-version keeps npm from committing/tagging; versioning here is
# per-deploy, not per-git-tag.

NEW_VERSION="$(npm version "${BUMP}" --no-git-tag-version)"
echo "==> Version bumped (${BUMP}) to ${NEW_VERSION#v}"

# ---- build (native on the server — no --platform, no QEMU emulation) --------
echo "==> Building image ${IMAGE_NAME}..."
docker build -t "${IMAGE_NAME}" -t "${IMAGE_NAME}:${NEW_VERSION#v}" .

# ---- (re)launch -------------------------------------------------------------
echo "==> Removing existing ${CONTAINER_NAME} container (if any)..."
docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

echo "==> Starting ${CONTAINER_NAME}..."
docker run -d \
    --name "${CONTAINER_NAME}" \
    --restart unless-stopped \
    "${IMAGE_NAME}"

echo "==> Done. ${CONTAINER_NAME} is running (headless worker — no port to open)."
echo "    Follow logs with:  docker logs -f ${CONTAINER_NAME}"
docker ps --filter "name=${CONTAINER_NAME}" \
    --format '    {{.Names}}  {{.Status}}  ({{.Image}})' || true

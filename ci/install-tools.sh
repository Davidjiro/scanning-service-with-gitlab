#!/usr/bin/env bash
# Installs the tools a CI job needs on top of the plain `node:22-bookworm` image.
#
#   AWS CLI v2   always      (assume the role, read stack outputs, smoke tests)
#   Docker CLI   if INSTALL_DOCKER=1   (CDK builds the container image; the daemon is the `docker:dind` service)
#
# Works on both aarch64 (GitLab SaaS arm64 runners) and x86_64 runners.
set -euo pipefail

case "$(uname -m)" in
  aarch64|arm64) ARCH=aarch64 ;;
  x86_64)        ARCH=x86_64 ;;
  *) echo "Unsupported CPU architecture: $(uname -m)" >&2; exit 1 ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends unzip jq gettext-base >/dev/null

if ! command -v aws >/dev/null 2>&1; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${ARCH}.zip" -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install >/dev/null
  rm -rf /tmp/aws /tmp/awscliv2.zip
fi

if [ "${INSTALL_DOCKER:-0}" = "1" ] && ! command -v docker >/dev/null 2>&1; then
  DOCKER_VERSION=27.5.1
  curl -fsSL "https://download.docker.com/linux/static/stable/${ARCH}/docker-${DOCKER_VERSION}.tgz" -o /tmp/docker.tgz
  tar -xzf /tmp/docker.tgz --strip-components=1 -C /usr/local/bin docker/docker
  rm -f /tmp/docker.tgz
fi

aws --version
if [ "${INSTALL_DOCKER:-0}" = "1" ]; then docker --version; fi

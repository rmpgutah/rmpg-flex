# kiosk-linux/docker/Dockerfile
#
# Buildroot officially supports Linux hosts only (confirmed by Task 1's Step 1
# native-build check: macOS's toolchain fails Buildroot's own host dependency
# check with "You must install 'gcc' on your build machine" — macOS's `gcc` is
# a Clang alias, not a real GCC, and Buildroot's build system otherwise assumes
# GNU coreutils / a POSIX toolchain producing ELF binaries that BSD-userland
# macOS doesn't provide). This image provides a real Linux userland with every
# package from Buildroot's documented "Mandatory packages" list
# (https://buildroot.org/downloads/manual/manual.html#requirement) so the
# actual Buildroot build runs unmodified inside a container, driven by
# ../build.sh via `docker run`.
FROM ubuntu:24.04

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential \
    which \
    sed \
    make \
    binutils \
    diffutils \
    gcc \
    g++ \
    bash \
    patch \
    gzip \
    bzip2 \
    perl \
    tar \
    cpio \
    unzip \
    rsync \
    file \
    bc \
    findutils \
    wget \
    git \
    python3 \
    ca-certificates \
    libncurses-dev \
    locales \
    libelf-dev \
    flex \
    bison \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*
# libelf-dev/flex/bison/libssl-dev: not in Buildroot's own "Mandatory packages"
# list, but the Linux kernel build's host-side tooling needs them regardless
# (objtool -- ORC unwind-table generation on x86_64 -- fails at compile time
# with "gelf.h: No such file or directory" without libelf-dev; kernel Kconfig
# parsing needs flex/bison; module/cert signing scripts need libssl-dev).
# Discovered the hard way during Task 1 -- see the kiosk-linux task-1 report.

# Buildroot refuses to build as root, so build.sh always runs this image with
# `docker run --user <host-uid>:<host-gid>` — no fixed user is baked into the
# image; whatever numeric UID/GID is passed in must be able to write to the
# bind-mounted kiosk-linux/ tree, which docker run also handles by matching
# the host user that owns those files.

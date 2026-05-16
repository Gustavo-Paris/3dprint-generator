FROM --platform=linux/amd64 ubuntu:24.04

# OrcaSlicer dependencies (Qt + GL libs even in CLI mode) + squashfs-tools for AppImage extraction
RUN apt-get update && apt-get install -y \
    curl \
    libgtk-3-0 \
    libwebkit2gtk-4.1-0 \
    libgl1-mesa-dri \
    libegl1 \
    libosmesa6 \
    libgstreamer-plugins-base1.0-0 \
    libgstreamer1.0-0 \
    xvfb \
    squashfs-tools \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Node.js 24 LTS for Express
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*
# pnpm crashes under qemu x86_64 (libuv epoll_ctl assertion); use npm in container

# Copy extraction helper (finds valid SquashFS v4.0 superblock in AppImage)
COPY extract-appimage.py /usr/local/bin/extract-appimage.py

# Download and extract OrcaSlicer AppImage (avoids executing x86_64 ELF under qemu)
WORKDIR /opt/orca
RUN curl -fL -o orca.AppImage "https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v2.3.2/OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.3.2.AppImage" \
    && python3 /usr/local/bin/extract-appimage.py orca.AppImage orca.squashfs \
    && unsquashfs -dest orca-extracted orca.squashfs \
    && rm orca.AppImage orca.squashfs

ENV ORCA_BIN=/opt/orca/orca-extracted/AppRun

WORKDIR /app
COPY package.json ./
RUN npm install
COPY src ./src
COPY profiles ./profiles

EXPOSE 8787
CMD ["npx", "tsx", "src/server.ts"]

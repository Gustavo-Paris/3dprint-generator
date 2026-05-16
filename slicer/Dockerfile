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
RUN npm install -g pnpm

# Extract OrcaSlicer AppImage using unsquashfs (avoids executing x86_64 ELF in emulation)
# AppImage is a SquashFS with a small ELF runtime prepended; find squashfs magic offset and extract
WORKDIR /opt/orca
RUN curl -fL -o orca.AppImage "https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v2.3.2/OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.3.2.AppImage" \
    && OFFSET=$(python3 -c 'import sys; d=open("orca.AppImage","rb").read(); i=d.find(b"hsqs"); i=d.find(b"sqsh") if i<0 else i; print(i)') \
    && unsquashfs -offset "$OFFSET" -dest orca-extracted orca.AppImage \
    && rm orca.AppImage

ENV ORCA_BIN=/opt/orca/orca-extracted/AppRun

WORKDIR /app
COPY package.json ./
RUN pnpm install
COPY src ./src
COPY profiles ./profiles

EXPOSE 8787
CMD ["pnpm", "start"]

#!/usr/bin/env python3
"""Extract SquashFS filesystem from an AppImage.

Usage: python3 extract-appimage.py <appimage> <output.squashfs>

Finds the valid SquashFS v4.0 superblock (magic 'hsqs' with major=4, minor=0)
and writes everything from that offset to the output file.
"""
import struct
import sys

src = sys.argv[1]
dst = sys.argv[2]

data = open(src, "rb").read()

pos = 0
off = -1
while True:
    i = data.find(b"hsqs", pos)
    if i < 0:
        break
    if len(data) > i + 32:
        maj, = struct.unpack("<H", data[i+28:i+30])
        mn, = struct.unpack("<H", data[i+30:i+32])
        if maj == 4 and mn == 0:
            off = i
            break
    pos = i + 1

if off < 0:
    sys.exit("ERROR: valid SquashFS v4.0 superblock not found in " + src)

print(f"Found squashfs superblock at offset {off}, writing {len(data)-off} bytes to {dst}")
open(dst, "wb").write(data[off:])
print("Done.")

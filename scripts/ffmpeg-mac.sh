#!/bin/sh
set -eu

VERSION=9.1
KEY=FCF986EA15E6E293A5644F10B4322F04D67658D8
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/src-tauri/binaries"
WORK="${TMPDIR:-/tmp}/hongsasub-ffmpeg-$VERSION"
JOBS=$(sysctl -n hw.ncpu)
MIN=11.0

mkdir -p "$WORK" "$OUT/ffmpeg-licence"
cd "$WORK"

if [ ! -f "ffmpeg-$VERSION.tar.xz" ]; then
  curl -fsSLO "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz"
  curl -fsSLO "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz.asc"
fi
gpg --list-keys "$KEY" >/dev/null 2>&1 || gpg --keyserver hkps://keyserver.ubuntu.com --recv-keys "$KEY"
gpg --status-fd 1 --verify "ffmpeg-$VERSION.tar.xz.asc" "ffmpeg-$VERSION.tar.xz" 2>/dev/null | grep -q "VALIDSIG $KEY"

FLAGS="--disable-autodetect --disable-gpl --disable-nonfree --disable-doc --disable-debug --disable-ffplay
  --disable-avdevice --disable-network --enable-static --disable-shared --enable-pthreads
  --enable-videotoolbox --enable-audiotoolbox --enable-zlib"

build() {
  arch=$1
  rm -rf "src-$arch" "out-$arch"
  mkdir "src-$arch"
  tar -xf "ffmpeg-$VERSION.tar.xz" -C "src-$arch" --strip-components 1
  cd "src-$arch"
  extra=""
  if [ "$arch" = x86_64 ]; then
    extra="--enable-cross-compile --target-os=darwin --x86asmexe=nasm"
  fi
  ./configure --prefix="$WORK/out-$arch" --arch="$arch" $extra $FLAGS \
    --cc="clang -arch $arch -mmacosx-version-min=$MIN" \
    --extra-ldflags="-arch $arch -mmacosx-version-min=$MIN" > "$WORK/configure-$arch.log"
  make -j"$JOBS" > "$WORK/make-$arch.log" 2>&1
  make install > /dev/null
  cd "$WORK"
}

build arm64
build x86_64

for tool in ffmpeg ffprobe; do
  cp "out-arm64/bin/$tool" "$OUT/$tool-aarch64-apple-darwin"
  cp "out-x86_64/bin/$tool" "$OUT/$tool-x86_64-apple-darwin"
  lipo -create "out-arm64/bin/$tool" "out-x86_64/bin/$tool" -output "$OUT/$tool-universal-apple-darwin"
  strip "$OUT/$tool-aarch64-apple-darwin" "$OUT/$tool-x86_64-apple-darwin" "$OUT/$tool-universal-apple-darwin"
done

cp "src-arm64/COPYING.LGPLv2.1" "$OUT/ffmpeg-licence/COPYING.LGPLv2.1"
cat > "$OUT/ffmpeg-licence/README.txt" <<EOF
HongsaSub includes FFmpeg $VERSION (https://ffmpeg.org), built by the HongsaSub project
for macOS on Apple Silicon and Intel.

FFmpeg is licensed under the GNU Lesser General Public License, version 2.1 or later.
The licence text is in COPYING.LGPLv2.1 next to this file. FFmpeg is a separate program
that HongsaSub runs; it is not linked into HongsaSub.

Source code: https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz
Built from that source, unmodified, with:
  ./configure $(echo $FLAGS)
The build script is scripts/ffmpeg-mac.sh in https://github.com/TaoMonLae/hongsasub
EOF

for tool in ffmpeg ffprobe; do
  otool -L "$OUT/$tool-universal-apple-darwin"
  lipo -info "$OUT/$tool-universal-apple-darwin"
done
"$OUT/ffmpeg-$(uname -m | sed s/arm64/aarch64/)-apple-darwin" -hide_banner -encoders | grep -E "h264_videotoolbox| aac "

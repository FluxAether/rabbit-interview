#!/bin/sh
set -eu

AUDIOTEE_REPOSITORY="https://github.com/makeusabrew/audiotee.git"
AUDIOTEE_COMMIT="56ac954369a09318e46b88a6eec33c2d2b0d32a3"
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE_DIR="$ROOT_DIR/src-tauri/target/audiotee-source"
BINARY_DIR="$ROOT_DIR/src-tauri/binaries"
CHECKSUM_LOG="$ROOT_DIR/src-tauri/target/audiotee-checksums.txt"

build_target() {
  tauri_target="$1"
  case "$tauri_target" in
    aarch64-apple-darwin)
      swift_triple="arm64-apple-macosx14.2"
      swift_output="arm64-apple-macosx"
      ;;
    x86_64-apple-darwin)
      swift_triple="x86_64-apple-macosx14.2"
      swift_output="x86_64-apple-macosx"
      ;;
    *)
      echo "Unsupported AudioTee target: $tauri_target" >&2
      exit 2
      ;;
  esac

  scratch="$ROOT_DIR/src-tauri/target/audiotee-$tauri_target"
  swift build -c release --package-path "$SOURCE_DIR" --scratch-path "$scratch" --triple "$swift_triple"
  # SwiftPM layout differs by toolchain:
  # - older: <scratch>/<triple-prefix>/release/audiotee
  # - Xcode 26 / Swift 6.4+: <scratch>/out/Products/Release/audiotee
  #   (and <scratch>/release is often a symlink to that Products dir)
  built=""
  for candidate in \
    "$scratch/$swift_output/release/audiotee" \
    "$scratch/release/audiotee" \
    "$scratch/out/Products/Release/audiotee"
  do
    if [ -f "$candidate" ]; then
      built="$candidate"
      break
    fi
  done
  if [ -z "$built" ]; then
    echo "AudioTee binary not found under $scratch" >&2
    exit 1
  fi
  actual=$(shasum -a 256 "$built" | awk '{print $1}')
  cp "$built" "$BINARY_DIR/audiotee-$tauri_target"
  chmod 755 "$BINARY_DIR/audiotee-$tauri_target"
  codesign -f -s - "$BINARY_DIR/audiotee-$tauri_target"
  printf '%s  %s\n' "$actual" "audiotee-$tauri_target" >> "$CHECKSUM_LOG"
  echo "AudioTee $tauri_target SHA-256: $actual"
}

if [ ! -d "$SOURCE_DIR/.git" ]; then
  git clone --filter=blob:none "$AUDIOTEE_REPOSITORY" "$SOURCE_DIR"
fi
git -C "$SOURCE_DIR" fetch --depth 1 origin "$AUDIOTEE_COMMIT"
git -C "$SOURCE_DIR" checkout --detach "$AUDIOTEE_COMMIT"
test "$(git -C "$SOURCE_DIR" rev-parse HEAD)" = "$AUDIOTEE_COMMIT"
printf 'commit=%s\n' "$AUDIOTEE_COMMIT" > "$CHECKSUM_LOG"

requested="${1:-}"
if [ "$requested" = "universal" ]; then
  build_target aarch64-apple-darwin
  build_target x86_64-apple-darwin
  universal="$BINARY_DIR/audiotee-universal-apple-darwin"
  lipo -create \
    "$BINARY_DIR/audiotee-aarch64-apple-darwin" \
    "$BINARY_DIR/audiotee-x86_64-apple-darwin" \
    -output "$universal"
  universal_checksum=$(shasum -a 256 "$universal" | awk '{print $1}')
  printf '%s  %s\n' "$universal_checksum" "audiotee-universal-apple-darwin" >> "$CHECKSUM_LOG"
  echo "AudioTee universal-apple-darwin SHA-256: $universal_checksum"
  chmod 755 "$universal"
  codesign -f -s - "$universal"
elif [ -n "$requested" ]; then
  build_target "$requested"
elif [ "$(uname -m)" = "arm64" ]; then
  build_target aarch64-apple-darwin
else
  build_target x86_64-apple-darwin
fi

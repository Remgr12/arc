#!/usr/bin/env bash
set -euo pipefail

# arc Local Build Script
# Builds the application for the current platform and creates distributable packages

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

Builds arc CAD for distribution.

Options:
  --target TARGET     Target triple (default: host)
  --bundle TYPE       Bundle type: appimage, deb, rpm, msi, nsis, dmg, flatpak (default: all for platform)
  --release           Build in release mode (default)
  --debug             Build in debug mode
  --clean             Clean build directory first
  --sign              Sign the bundles (requires certificates)
  -h, --help          Show this help

Examples:
  $0                                    # Build for current platform
  $0 --target x86_64-pc-windows-msvc   # Cross-compile for Windows
  $0 --bundle flatpak                   # Build Flatpak only
  $0 --clean --release                  # Clean release build
EOF
}

detect_platform() {
    case "$(uname -s)" in
        Linux*)   echo "linux" ;;
        Darwin*)  echo "macos" ;;
        CYGWIN*|MINGW*|MSYS*) echo "windows" ;;
        *)        echo "unknown" ;;
    esac
}

detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64) echo "x86_64" ;;
        aarch64|arm64) echo "aarch64" ;;
        *) echo "unknown" ;;
    esac
}

main() {
    local target=""
    local bundle_type=""
    local build_mode="release"
    local clean_build=false
    local sign_bundles=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --target) target="$2"; shift 2 ;;
            --bundle) bundle_type="$2"; shift 2 ;;
            --release) build_mode="release"; shift ;;
            --debug) build_mode="debug"; shift ;;
            --clean) clean_build=true; shift ;;
            --sign) sign_bundles=true; shift ;;
            -h|--help) usage; exit 0 ;;
            *) log_error "Unknown option: $1"; usage; exit 1 ;;
        esac
    done

    cd "${PROJECT_ROOT}"

    # Detect platform if target not specified
    if [[ -z "${target}" ]]; then
        local platform=$(detect_platform)
        local arch=$(detect_arch)
        case "${platform}" in
            linux) target="x86_64-unknown-linux-gnu" ;;
            macos) target="x86_64-apple-darwin" ;;
            windows) target="x86_64-pc-windows-msvc" ;;
            *) log_error "Unknown platform: ${platform}"; exit 1 ;;
        esac
        log_info "Auto-detected target: ${target}"
    fi

    # Determine bundle types if not specified
    if [[ -z "${bundle_type}" ]]; then
        case "${target}" in
            *-windows-*) bundle_type="msi,nsis" ;;
            *-linux-*) bundle_type="appimage,deb,rpm,flatpak" ;;
            *-apple-darwin) bundle_type="dmg,app" ;;
            *) bundle_type="all" ;;
        esac
    fi

    log_info "Building for target: ${target}"
    log_info "Bundle types: ${bundle_type}"
    log_info "Build mode: ${build_mode}"

    # Clean if requested
    if [[ "${clean_build}" == true ]]; then
        log_info "Cleaning build directory..."
        cargo clean
    fi

    # Install required targets
    rustup target add "${target}" 2>/dev/null || true

    # Build frontend
    log_info "Building frontend..."
    cd "${PROJECT_ROOT}/frontend"
    npm ci
    npm run build
    cd "${PROJECT_ROOT}"

    # Build with Tauri
    local tauri_args="--target ${target}"
    if [[ "${build_mode}" == "release" ]]; then
        tauri_args="${tauri_args} --release"
    fi
    if [[ -n "${bundle_type}" && "${bundle_type}" != "all" ]]; then
        tauri_args="${tauri_args} --bundle ${bundle_type}"
    fi

    log_info "Running: cargo tauri build ${tauri_args}"
    cargo tauri build ${tauri_args}

    log_success "Build complete!"
    log_info "Artifacts in: ${PROJECT_ROOT}/target/${target}/${build_mode}/bundle/"

    # List created artifacts
    find "${PROJECT_ROOT}/target/${target}/${build_mode}/bundle" -type f \( -name "*.AppImage" -o -name "*.deb" -o -name "*.rpm" -o -name "*.msi" -o -name "*.exe" -o -name "*.dmg" -o -name "*.flatpak" \) 2>/dev/null | while read -r file; do
        log_success "Created: ${file}"
    done
}

main "$@"
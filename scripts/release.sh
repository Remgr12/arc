#!/usr/bin/env bash
set -euo pipefail

# ARC Release Script
# Usage: ./scripts/release.sh [patch|minor|major] [--dry-run]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VERSION_TYPE="${1:-patch}"
DRY_RUN="${2:-}"

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
Usage: $0 [patch|minor|major] [--dry-run]

Bumps version, creates git tag, pushes to GitHub, and triggers release workflow.

Options:
  patch    - Increment patch version (0.1.0 -> 0.1.1)
  minor    - Increment minor version (0.1.0 -> 0.2.0)
  major    - Increment major version (0.1.0 -> 1.0.0)
  --dry-run - Show what would be done without executing

Environment variables:
  GITHUB_TOKEN - Required for pushing tags and creating releases
  GPG_KEY_ID   - Optional GPG key for signing tags

Examples:
  $0 patch
  $0 minor --dry-run
  $0 major
EOF
}

get_current_version() {
    grep '^version = ' "${PROJECT_ROOT}/Cargo.toml" | head -1 | sed 's/version = "\(.*\)"/\1/'
}

bump_version() {
    local current_version="$1"
    local bump_type="$2"
    local major minor patch
    IFS='.' read -r major minor patch <<< "$current_version"
    case "$bump_type" in
        major) ((major++)); minor=0; patch=0 ;;
        minor) ((minor++)); patch=0 ;;
        patch) ((patch++)) ;;
        *) log_error "Invalid bump type: $bump_type"; exit 1 ;;
    esac
    echo "${major}.${minor}.${patch}"
}

update_cargo_toml() {
    local new_version="$1"
    sed -i "s/^version = \".*\"/version = \"${new_version}\"/" "${PROJECT_ROOT}/Cargo.toml"
    log_info "Updated Cargo.toml to version ${new_version}"
}

update_tauri_conf() {
    local new_version="$1"
    # Update root tauri.conf.json
    sed -i "s/\"version\": \".*\"/\"version\": \"${new_version}\"/" "${PROJECT_ROOT}/tauri.conf.json"
    # Update arc-app tauri.conf.json
    sed -i "s/\"version\": \".*\"/\"version\": \"${new_version}\"/" "${PROJECT_ROOT}/crates/arc-app/tauri.conf.json"
    log_info "Updated tauri.conf.json files to version ${new_version}"
}

update_flatpak_manifest() {
    local new_version="$1"
    # Flatpak manifest version is handled by the build process
    # but we can update the metainfo.xml
    sed -i "s/<release version=\".*\" date=\".*\">/<release version=\"${new_version}\" date=\"$(date +%Y-%m-%d)\">/" "${PROJECT_ROOT}/flatpak/com.arc.cad.metainfo.xml"
    log_info "Updated flatpak metainfo.xml to version ${new_version}"
}

commit_changes() {
    local new_version="$1"
    git add "${PROJECT_ROOT}/Cargo.toml" \
            "${PROJECT_ROOT}/tauri.conf.json" \
            "${PROJECT_ROOT}/crates/arc-app/tauri.conf.json" \
            "${PROJECT_ROOT}/flatpak/com.arc.cad.metainfo.xml"
    git commit -m "chore: release v${new_version}"
    log_success "Committed version bump to v${new_version}"
}

create_tag() {
    local new_version="$1"
    local tag="v${new_version}"
    if [[ -n "${GPG_KEY_ID:-}" ]]; then
        git tag -s "${tag}" -m "Release ${tag}" -u "${GPG_KEY_ID}"
    else
        git tag -a "${tag}" -m "Release ${tag}"
    fi
    log_success "Created tag ${tag}"
}

push_changes() {
    local new_version="$1"
    git push origin main
    git push origin "v${new_version}"
    log_success "Pushed changes and tag v${new_version} to origin"
}

trigger_workflow() {
    local new_version="$1"
    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
        log_info "Triggering release workflow..."
        curl -X POST \
            -H "Authorization: token ${GITHUB_TOKEN}" \
            -H "Accept: application/vnd.github.v3+json" \
            "https://api.github.com/repos/$(git config --get remote.origin.url | sed 's/.*github.com[:/]\([^.]*\).*/\1/')/actions/workflows/release.yml/dispatches" \
            -d "{\"ref\":\"main\",\"inputs\":{\"version_type\":\"${VERSION_TYPE}\"}}" || log_warn "Failed to trigger workflow (may not exist yet)"
    else
        log_warn "GITHUB_TOKEN not set, skipping workflow trigger"
    fi
}

main() {
    cd "${PROJECT_ROOT}"

    # Check if we're in a git repo
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        log_error "Not in a git repository"
        exit 1
    fi

    # Check for uncommitted changes
    if [[ -n "$(git status --porcelain)" ]]; then
        log_error "Working directory has uncommitted changes. Commit or stash them first."
        exit 1
    fi

    # Get current version
    local current_version
    current_version=$(get_current_version)
    log_info "Current version: ${current_version}"

    # Bump version
    local new_version
    new_version=$(bump_version "${current_version}" "${VERSION_TYPE}")
    log_info "New version: ${new_version}"

    if [[ "${DRY_RUN}" == "--dry-run" ]]; then
        log_warn "DRY RUN - Would perform the following:"
        echo "  1. Update Cargo.toml to ${new_version}"
        echo "  2. Update tauri.conf.json files to ${new_version}"
        echo "  3. Update flatpak metainfo.xml to ${new_version}"
        echo "  4. Commit changes"
        echo "  5. Create tag v${new_version}"
        echo "  6. Push to origin"
        echo "  7. Trigger GitHub Actions workflow"
        exit 0
    fi

    # Confirm
    read -p "Release v${new_version}? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Aborted"
        exit 0
    fi

    # Update version files
    update_cargo_toml "${new_version}"
    update_tauri_conf "${new_version}"
    update_flatpak_manifest "${new_version}"

    # Commit and tag
    commit_changes "${new_version}"
    create_tag "${new_version}"

    # Push
    push_changes "${new_version}"

    # Trigger workflow
    trigger_workflow "${new_version}"

    log_success "Release v${new_version} initiated!"
    log_info "GitHub Actions will build and create the release."
    log_info "Check: https://github.com/$(git config --get remote.origin.url | sed 's/.*github.com[:/]\([^.]*\).*/\1/')/actions"
}

# Check arguments
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
fi

if [[ ! "${VERSION_TYPE}" =~ ^(patch|minor|major)$ ]]; then
    log_error "Invalid version type: ${VERSION_TYPE}"
    usage
    exit 1
fi

main
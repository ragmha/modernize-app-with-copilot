#!/usr/bin/env bash
set -euo pipefail

version=1.0.74
digest=1e1d7dae8530d503f7507f6f9c7df8a5e9d43088d3c3df532b4ea24e27926783
if [[ "${1:-}" != "--accept-license" ]]; then
  printf '%s\n' \
    "Read https://github.com/microsoft/modernize-cli#license before installing." \
    "This downloads Microsoft's proprietary product for your own use, not redistribution." \
    "If you accept the applicable terms, rerun: bash scripts/install-modernize.sh --accept-license"
  exit 1
fi
if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  printf '%s\n' "This pinned helper targets Linux x64 Codespaces only. Use the official installer for other platforms." >&2
  exit 1
fi
destination="$HOME/.local/share/modernize/$version"
link="$HOME/.local/bin/modernize"
if [[ -e "$destination" || -e "$link" || -L "$link" ]]; then
  printf '%s\n' "An installation already exists. Inspect it; this helper will not overwrite it." >&2
  exit 1
fi
temporary="$(mktemp -d)"
trap 'rm -f "$temporary/modernize.tar.gz"; rmdir "$temporary"' EXIT
curl --fail --location --retry 3 \
  "https://github.com/microsoft/modernize-cli/releases/download/v$version/modernize_${version}_linux_x64.tar.gz" \
  --output "$temporary/modernize.tar.gz"
printf '%s  %s\n' "$digest" "$temporary/modernize.tar.gz" | sha256sum --check --status
mkdir -p "$destination" "$HOME/.local/bin"
tar -xzf "$temporary/modernize.tar.gz" -C "$destination"
if [[ ! -f "$destination/modernize" || ! -d "$destination/runtimes" ]]; then
  printf '%s\n' "Unexpected release layout. No executable link was created; inspect the download." >&2
  exit 1
fi
chmod u+x "$destination/modernize"
ln -s "$destination/modernize" "$link"
"$link" --version
printf '\nAdd this to the current terminal if needed: export PATH="$HOME/.local/bin:$PATH"\n'
printf 'Authenticate using GitHub CLI as documented; this script does not sign you in.\n'

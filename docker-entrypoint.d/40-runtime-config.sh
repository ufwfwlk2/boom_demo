#!/bin/sh
set -eu

RUNTIME_CONFIG_PATH="${RUNTIME_CONFIG_PATH:-/tmp/heykool-ops-runtime-config.js}"

escape_js() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

write_config_value() {
  key="$1"
  value="$(escape_js "${2:-}")"
  printf '  %s: "%s",\n' "$key" "$value"
}

mkdir -p "$(dirname "$RUNTIME_CONFIG_PATH")"

{
  printf 'window.__HEYKOOL_RUNTIME_CONFIG__ = Object.assign({}, window.__HEYKOOL_RUNTIME_CONFIG__ || {}, {\n'
  write_config_value 'VITE_BOOMCLIP_API_BASE_URL' "${VITE_BOOMCLIP_API_BASE_URL:-}"
  write_config_value 'VITE_BOOMCLIP_AUTH_BASE_URL' "${VITE_BOOMCLIP_AUTH_BASE_URL:-}"
  write_config_value 'VITE_BOOMCLIP_LOGIN_PHONE' "${VITE_BOOMCLIP_LOGIN_PHONE:-}"
  write_config_value 'VITE_PREVIEW_DEV_MODE' "${VITE_PREVIEW_DEV_MODE:-}"
  printf '});\n'
} > "$RUNTIME_CONFIG_PATH"

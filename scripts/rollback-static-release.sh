#!/bin/sh

set -eu

fail() {
  printf '%s\n' "Rollback failed: $*" >&2
  exit 1
}

validate_sha() {
  [ "${#1}" -eq 40 ] || fail 'SHA must contain exactly 40 characters'
  case "$1" in
    *[!0-9a-f]*) fail 'SHA must be lowercase hexadecimal' ;;
  esac
}

validate_root() {
  case "$1" in
    ''|'/'|*..*|*[!A-Za-z0-9_./-]*) fail 'deployment root is unsafe' ;;
    /*) ;;
    *) fail 'deployment root must be absolute' ;;
  esac
  [ -d "$1" ] || fail 'deployment root does not exist'
  canonical_root=$(unset CDPATH; cd -- "$1" && pwd -P)
  [ "$canonical_root" = "$1" ] || fail 'deployment root must be canonical'
}

validate_transaction() {
  transaction_run=${1%%-*}
  transaction_attempt=${1#*-}
  [ "$1" = "$transaction_run-$transaction_attempt" ] ||
    fail 'transaction must be positive-decimal-hyphen-positive-decimal'
  case "$transaction_run" in
    ''|0*|*[!0-9]*)
      fail 'transaction run ID must be a positive decimal without leading zeros'
      ;;
  esac
  case "$transaction_attempt" in
    ''|0*|*[!0-9]*)
      fail 'transaction attempt must be a positive decimal without leading zeros'
      ;;
  esac
  if [ "${#transaction_run}" -gt 20 ] ||
    [ "${#transaction_attempt}" -gt 20 ]; then
    fail 'transaction components must contain at most 20 digits'
  fi
}

validate_release_tree() {
  release_tree=$1
  if ! { [ -d "$release_tree" ] && [ ! -L "$release_tree" ]; }; then
    fail 'rollback release is missing or unsafe'
  fi
  if ! {
    [ -f "$release_tree/index.html" ] &&
      [ ! -L "$release_tree/index.html" ]
  }; then
    fail 'rollback release has no safe index.html'
  fi
  find "$release_tree" \! -type f \! -type d -print -quit | grep -q . &&
    fail 'rollback release contains a symlink or special file'
  find "$release_tree" -type f \( -name '*.js' -o -name '*.css' \) -print -quit |
    grep -q . || fail 'rollback release has no JS/CSS asset'
}

validate_release_target() {
  validated_release_target=$1
  case "$validated_release_target" in
    releases/*)
      validated_target_sha=${validated_release_target#releases/}
      validate_sha "$validated_target_sha"
      [ "$validated_release_target" = "releases/$validated_target_sha" ] ||
        fail 'rollback target is nested'
      validate_release_tree "$root/$validated_release_target"
      ;;
    *) fail 'rollback target points outside releases' ;;
  esac
}

file_id() {
  stat -c '%d:%i' -- "$1" 2>/dev/null
}

marker_is_owned() {
  [ -f "$marker_guard" ] && [ ! -L "$marker_guard" ] &&
    [ -f "$marker" ] && [ ! -L "$marker" ] &&
    [ "$(file_id "$marker")" = "$(file_id "$marker_guard")" ]
}

current_is_owned() {
  [ -L "$current_guard" ] &&
    [ "$(readlink "$current_guard" 2>/dev/null)" = "$target" ] &&
    [ -L "$current_link" ] &&
    [ "$(readlink "$current_link" 2>/dev/null)" = "$target" ] &&
    [ "$(file_id "$current_link")" = "$(file_id "$current_guard")" ]
}

[ "$#" -eq 3 ] ||
  fail 'usage: rollback-static-release.sh <sha> <root> <transaction>'
sha=$1
root=$2
transaction=$3
validate_sha "$sha"
validate_root "$root"
validate_transaction "$transaction"
for required_command in flock stat; do
  command -v "$required_command" >/dev/null 2>&1 ||
    fail "required command is unavailable: $required_command"
done

marker=$root/.rollback-$sha
incoming=$root/incoming-$sha-$transaction.tar.gz
marker_guard=$root/.rollback-marker-$sha-$transaction
current_guard=$root/.rollback-current-$sha-$transaction
current_link=$root/current
lock_file=$root/.deployment.lock
temporary_link=$root/.current-rollback-$sha-$transaction-$$
target=releases/$sha

cleanup() {
  rm -f -- "$temporary_link"
}
trap cleanup EXIT HUP INT TERM

if [ -e "$lock_file" ] || [ -L "$lock_file" ]; then
  if ! { [ -f "$lock_file" ] && [ ! -L "$lock_file" ]; }; then
    fail 'deployment lock is unsafe'
  fi
else
  umask 077
  : >"$lock_file"
fi
exec 9>>"$lock_file"
flock -x 9 || fail 'could not acquire deployment lock'
if ! { [ -f "$lock_file" ] && [ ! -L "$lock_file" ]; }; then
  fail 'deployment lock changed unexpectedly'
fi

marker_owned=false
current_owned=false
if marker_is_owned; then
  marker_owned=true
fi
if current_is_owned; then
  current_owned=true
fi

if [ "$marker_owned" = false ] || [ "$current_owned" = false ]; then
  if [ "$marker_owned" = true ]; then
    rm -f -- "$marker"
  fi
  rm -f -- "$incoming" "$marker_guard" "$current_guard"
  printf '%s\n' "No deployment state owned by transaction $transaction"
  exit 0
fi

marker_lines=$(wc -l <"$marker") || fail 'rollback marker is unreadable'
[ "$marker_lines" -eq 1 ] || fail 'rollback marker is malformed'
{
  IFS= read -r previous_target || fail 'rollback marker is unreadable'
  marker_remainder=
  if IFS= read -r marker_remainder || [ -n "$marker_remainder" ]; then
    fail 'rollback marker is malformed'
  fi
} <"$marker"

case "$previous_target" in
  NONE|SAME) ;;
  releases/*) validate_release_target "$previous_target" ;;
  *) fail 'rollback marker target is invalid' ;;
esac
validate_release_tree "$root/$target"

case "$previous_target" in
  SAME)
    ;;
  NONE)
    rm -f -- "$current_link"
    if [ -e "$current_link" ] || [ -L "$current_link" ]; then
      fail 'could not remove current for first-deploy rollback'
    fi
    ;;
  releases/*)
    ln -s "$previous_target" "$temporary_link"
    mv -Tf -- "$temporary_link" "$current_link"
    if ! {
      [ -L "$current_link" ] &&
        [ "$(readlink "$current_link")" = "$previous_target" ]
    }; then
      fail 'atomic rollback switch failed'
    fi
    ;;
esac

rm -f -- "$marker" "$incoming" "$marker_guard" "$current_guard"
printf '%s\n' "Rolled back failed release $sha in transaction $transaction"

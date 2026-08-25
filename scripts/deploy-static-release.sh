#!/bin/sh

set -eu

fail() {
  printf '%s\n' "Deployment refused: $*" >&2
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
  [ -d "$release_tree" ] || fail 'release directory is missing'
  [ ! -L "$release_tree" ] || fail 'release directory cannot be a symlink'
  [ -f "$release_tree/index.html" ] || fail 'release has no index.html'
  [ ! -L "$release_tree/index.html" ] || fail 'index.html cannot be a symlink'
  find "$release_tree" \! -type f \! -type d -print -quit | grep -q . &&
    fail 'release contains a symlink or special file'
  find "$release_tree" -type f \( -name '*.js' -o -name '*.css' \) -print -quit |
    grep -q . || fail 'release has no JS/CSS asset'
}

validate_archive() {
  archive_path=$1
  [ -f "$archive_path" ] || fail 'incoming archive is missing'
  [ ! -L "$archive_path" ] || fail 'incoming archive cannot be a symlink'
  tar --absolute-names --quoting-style=escape -tzf "$archive_path" >/dev/null ||
    fail 'archive is unreadable'

  tar --absolute-names --quoting-style=escape -tzf "$archive_path" |
    while IFS= read -r entry; do
      case "$entry" in
        '.'|'./') ;;
        ''|/*|..|../*|*/.|*/..|*/../*|*/./*|*'//'*|*\\*)
          fail 'archive contains an unsafe path'
          ;;
      esac
    done || fail 'archive path validation failed'

  tar --absolute-names --quoting-style=escape -tvzf "$archive_path" |
    while IFS= read -r listing; do
      case "$listing" in
        [-d]*) ;;
        *) fail 'archive contains a link or special entry' ;;
      esac
    done || fail 'archive entry-type validation failed'
}

validate_release_target() {
  validated_release_target=$1
  case "$validated_release_target" in
    releases/*)
      validated_target_sha=${validated_release_target#releases/}
      validate_sha "$validated_target_sha"
      [ "$validated_release_target" = "releases/$validated_target_sha" ] ||
        fail 'release target is nested'
      validate_release_tree "$root/$validated_release_target"
      ;;
    *) fail 'release target points outside releases' ;;
  esac
}

validate_marker_target() {
  case "$1" in
    NONE|SAME) ;;
    releases/*) validate_release_target "$1" ;;
    *) fail 'rollback marker target is invalid' ;;
  esac
}

read_marker() {
  marker_path=$1
  if ! { [ -f "$marker_path" ] && [ ! -L "$marker_path" ]; }; then
    fail 'rollback marker is unsafe'
  fi
  marker_lines=$(wc -l <"$marker_path") || fail 'rollback marker is unreadable'
  [ "$marker_lines" -eq 1 ] || fail 'rollback marker is malformed'
  {
    IFS= read -r marker_target || fail 'rollback marker is unreadable'
    marker_remainder=
    if IFS= read -r marker_remainder || [ -n "$marker_remainder" ]; then
      fail 'rollback marker is malformed'
    fi
  } <"$marker_path"
  validate_marker_target "$marker_target"
}

validate_watchdog_delay() {
  if [ "${SNAKISH_ROLLBACK_WATCHDOG_SECONDS+x}" = x ]; then
    watchdog_delay=$SNAKISH_ROLLBACK_WATCHDOG_SECONDS
  else
    watchdog_delay=150
  fi
  case "$watchdog_delay" in
    ''|*[!0-9]*) fail 'watchdog delay must be an integer number of seconds' ;;
  esac
  if ! { [ "$watchdog_delay" -ge 1 ] && [ "$watchdog_delay" -le 600 ]; }; then
    fail 'watchdog delay must be between 1 and 600 seconds'
  fi
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

start_watchdog() {
  # The fixed program below receives all dynamic data as quoted positional
  # parameters. Descriptor 9 is closed so the child cannot retain our lock.
  # Expansion in this program belongs to the detached shell.
  # shellcheck disable=SC2016
  nohup sh -c '
    set -u
    delay=$1
    root=$2
    sha=$3
    transaction=$4
    marker_guard=$5
    current_guard=$6
    marker=$root/.rollback-$sha
    incoming=$root/incoming-$sha-$transaction.tar.gz
    current_link=$root/current
    target=releases/$sha
    lock_file=$root/.deployment.lock
    temporary_link=$root/.current-watchdog-$sha-$transaction-$$

    cleanup_temporary() {
      rm -f -- "$temporary_link" "$marker_guard" "$current_guard" "$incoming"
    }
    stop() {
      exit 0
    }
    trap cleanup_temporary EXIT
    trap stop INT TERM

    file_id() {
      stat -c "%d:%i" -- "$1" 2>/dev/null
    }

    marker_is_ours() {
      [ -f "$marker_guard" ] && [ ! -L "$marker_guard" ] &&
        [ -f "$marker" ] && [ ! -L "$marker" ] &&
        [ "$(file_id "$marker")" = "$(file_id "$marker_guard")" ]
    }

    current_is_ours() {
      [ -L "$current_guard" ] &&
        [ "$(readlink "$current_guard" 2>/dev/null)" = "$target" ] &&
        [ -L "$current_link" ] &&
        [ "$(readlink "$current_link" 2>/dev/null)" = "$target" ] &&
        [ "$(file_id "$current_link")" = "$(file_id "$current_guard")" ]
    }

    valid_sha() {
      [ "${#1}" -eq 40 ] || return 1
      case "$1" in *[!0-9a-f]*) return 1 ;; esac
    }

    valid_release() {
      candidate=$1
      [ -d "$candidate" ] && [ ! -L "$candidate" ] || return 1
      [ -f "$candidate/index.html" ] && [ ! -L "$candidate/index.html" ] ||
        return 1
      find "$candidate" \! -type f \! -type d -print -quit | grep -q . &&
        return 1
      find "$candidate" -type f \( -name "*.js" -o -name "*.css" \) \
        -print -quit | grep -q .
    }

    cleanup_transaction() {
      if marker_is_ours; then
        rm -f -- "$marker"
      fi
      rm -f -- "$incoming"
    }

    remaining=$delay
    while [ "$remaining" -gt 0 ]; do
      sleep 1 || exit 0
      marker_is_ours || exit 0
      remaining=$((remaining - 1))
    done

    [ -f "$lock_file" ] && [ ! -L "$lock_file" ] || exit 0
    exec 9>>"$lock_file" || exit 0
    flock -x 9 || exit 0
    marker_is_ours || exit 0

    marker_lines=$(wc -l <"$marker" 2>/dev/null) || exit 0
    [ "$marker_lines" -eq 1 ] || exit 0
    {
      IFS= read -r previous_target || exit 0
      marker_remainder=
      if IFS= read -r marker_remainder || [ -n "$marker_remainder" ]; then
        exit 0
      fi
    } <"$marker"

    if ! current_is_ours; then
      cleanup_transaction
      exit 0
    fi
    valid_release "$root/$target" || exit 0

    case "$previous_target" in
      SAME)
        ;;
      NONE)
        rm -f -- "$current_link"
        [ ! -e "$current_link" ] && [ ! -L "$current_link" ] || exit 0
        ;;
      releases/*)
        previous_sha=${previous_target#releases/}
        valid_sha "$previous_sha" || exit 0
        [ "$previous_target" = "releases/$previous_sha" ] || exit 0
        valid_release "$root/$previous_target" || exit 0
        ln -s "$previous_target" "$temporary_link" || exit 0
        mv -Tf -- "$temporary_link" "$current_link" || exit 0
        [ -L "$current_link" ] &&
          [ "$(readlink "$current_link")" = "$previous_target" ] || exit 0
        ;;
      *) exit 0 ;;
    esac

    cleanup_transaction
  ' snakish-rollback-watchdog "$watchdog_delay" "$root" "$sha" \
    "$transaction" "$marker_guard" "$current_guard" \
    9>&- </dev/null >/dev/null 2>&1 &
}

[ "$#" -eq 4 ] ||
  fail 'usage: deploy-static-release.sh <sha> <root> <transaction> <activate|finalize>'

sha=$1
root=$2
transaction=$3
action=$4
validate_sha "$sha"
validate_root "$root"
validate_transaction "$transaction"
case "$action" in
  activate) validate_watchdog_delay ;;
  finalize) ;;
  *) fail 'unknown deployment action' ;;
esac

for required_command in flock stat nohup sleep; do
  command -v "$required_command" >/dev/null 2>&1 ||
    fail "required command is unavailable: $required_command"
done

releases=$root/releases
current_link=$root/current
release=$releases/$sha
incoming=$root/incoming-$sha-$transaction.tar.gz
marker=$root/.rollback-$sha
marker_guard=$root/.rollback-marker-$sha-$transaction
current_guard=$root/.rollback-current-$sha-$transaction
lock_file=$root/.deployment.lock
temporary_release=$releases/.release-$sha-$transaction-$$
temporary_link=$root/.current-$sha-$transaction-$$
temporary_marker=$root/.rollback-$sha-$transaction-$$
prune_list=$root/.prune-$sha-$transaction-$$
target=releases/$sha
ownership_established=false

cleanup() {
  rm -rf -- "$temporary_release"
  rm -f -- "$temporary_link" "$temporary_marker" "$prune_list"
  if [ "$ownership_established" = false ]; then
    rm -f -- "$marker_guard" "$current_guard"
  fi
}
trap cleanup EXIT HUP INT TERM

[ -d "$releases" ] || fail 'releases directory is missing'
[ ! -L "$releases" ] || fail 'releases directory cannot be a symlink'
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

if [ "$action" = finalize ]; then
  if ! marker_is_owned || ! current_is_owned; then
    rm -f -- "$incoming" "$marker_guard" "$current_guard"
    fail 'transaction no longer owns deployment state'
  fi
  validate_release_tree "$release"

  rm -f -- "$marker" "$incoming" "$marker_guard" "$current_guard"
  find "$releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' |
    LC_ALL=C sort -k1,1nr -k2,2 >"$prune_list"
  prior_count=0
  while IFS=' ' read -r _modified name; do
    [ -n "$name" ] || continue
    [ "${#name}" -eq 40 ] || continue
    case "$name" in
      *[!0-9a-f]*) continue ;;
    esac
    [ "$name" = "$sha" ] && continue
    prior_count=$((prior_count + 1))
    if [ "$prior_count" -gt 2 ]; then
      candidate=$releases/$name
      if ! { [ -d "$candidate" ] && [ ! -L "$candidate" ]; }; then
        fail 'prune candidate changed unexpectedly'
      fi
      rm -rf -- "$candidate"
    fi
  done <"$prune_list"

  if ! {
    [ -L "$current_link" ] &&
      [ "$(readlink "$current_link")" = "$target" ]
  }; then
    fail 'current changed during finalize'
  fi
  printf '%s\n' "Finalized release $sha"
  exit 0
fi

if [ -L "$current_link" ]; then
  current_target=$(readlink "$current_link") || fail 'current is unreadable'
  validate_release_target "$current_target"
elif [ -e "$current_link" ]; then
  fail 'current exists but is not a symlink'
else
  current_target=NONE
fi

if [ -e "$marker" ] || [ -L "$marker" ]; then
  read_marker "$marker"
  marker_exists=true
else
  marker_exists=false
fi

if [ "$current_target" = "$target" ]; then
  if [ "$marker_exists" = true ]; then
    predecessor=$marker_target
  else
    predecessor=SAME
  fi
else
  predecessor=$current_target
fi

if [ -d "$release" ] && [ ! -L "$release" ]; then
  validate_release_tree "$release"
else
  if [ -e "$release" ] || [ -L "$release" ]; then
    fail 'release path is unsafe'
  fi
  validate_archive "$incoming"
  mkdir -m 700 -- "$temporary_release"
  tar -xzf "$incoming" -C "$temporary_release" --no-same-owner --no-same-permissions
  validate_release_tree "$temporary_release"
  find "$temporary_release" -type d -exec chmod 755 {} +
  find "$temporary_release" -type f -exec chmod 644 {} +
  mv -- "$temporary_release" "$release"
fi

touch "$release"
if [ -e "$marker_guard" ] || [ -L "$marker_guard" ]; then
  fail 'transaction marker guard already exists'
fi
if [ -e "$current_guard" ] || [ -L "$current_guard" ]; then
  fail 'transaction current guard already exists'
fi

umask 077
printf '%s\n' "$predecessor" >"$temporary_marker"
ln -s "$target" "$temporary_link"
ln -P -- "$temporary_marker" "$marker_guard"
ln -P -- "$temporary_link" "$current_guard"
if ! { [ -f "$marker_guard" ] && [ ! -L "$marker_guard" ]; }; then
  fail 'could not guard rollback marker identity'
fi
[ -L "$current_guard" ] || fail 'could not guard current identity'

mv -f -- "$temporary_marker" "$marker"
ownership_established=true
marker_is_owned || fail 'atomic marker adoption failed'
mv -Tf -- "$temporary_link" "$current_link"
current_is_owned || fail 'atomic current switch failed'
validate_release_tree "$release"

start_watchdog
printf '%s\n' "Activated release $sha in transaction $transaction"

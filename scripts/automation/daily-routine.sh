#!/usr/bin/env bash
# DogeSwap daily routine — headless Claude Code run of /daily-routine.
# Invoked by the dogeswap-daily-routine systemd user timer (07:00 America/New_York);
# safe to run manually: bash scripts/automation/daily-routine.sh
# See docs/automation.md for setup, logs, and the permission model.
#
# Everything lives inside main() so bash parses the whole file before executing:
# the `git reset --hard` below may update THIS script mid-run otherwise.
set -uo pipefail

main() {
  # Node 22 (system node is 18 and breaks the test suite) + user-local tools
  # (claude, slither via ~/.local/bin).
  export PATH="/home/actlabs/.nvm/versions/node/v22.22.3/bin:$HOME/.local/bin:$PATH"

  local routine_dir="${ROUTINE_DIR:-$HOME/dogeswap-routine}"
  local log_dir="$HOME/dogeswap-routine-logs"
  local repo_url="https://github.com/worldofhacks/dogeos.git"
  mkdir -p "$log_dir"
  local log_file="$log_dir/$(date +%F).log"

  # Dedicated checkout: never the live prod/staging service directories.
  if [ ! -d "$routine_dir/.git" ]; then
    git clone "$repo_url" "$routine_dir" || return 1
  fi
  cd "$routine_dir" || return 1
  git fetch origin && git checkout -q main && git reset --hard -q origin/main || return 1
  npm ci --no-audit --no-fund >>"$log_file" 2>&1 || return 1

  # Explicit tool allowlist — deliberately NOT --dangerously-skip-permissions.
  # Scope: git/gh/build/test/deploy commands, file edits, web research, subagents.
  local allowed_tools=(
    "Read" "Glob" "Grep" "Edit" "Write"
    "Agent" "Skill" "TaskCreate" "TaskUpdate" "TaskList" "TaskGet" "TaskOutput"
    "WebSearch" "WebFetch"
    "Bash(git:*)" "Bash(gh:*)" "Bash(forge:*)" "Bash(npm:*)" "Bash(npx:*)"
    "Bash(node:*)" "Bash(slither:*)" "Bash(curl:*)" "Bash(python3:*)"
    "Bash(/home/actlabs/dogeswap-deploy/deploy.sh:*)"
    "Bash(ls:*)" "Bash(cat:*)" "Bash(head:*)" "Bash(tail:*)" "Bash(wc:*)"
    "Bash(grep:*)" "Bash(find:*)" "Bash(mkdir:*)" "Bash(cp:*)" "Bash(mv:*)"
    "Bash(sed:*)" "Bash(awk:*)" "Bash(diff:*)" "Bash(export:*)" "Bash(cd:*)"
    "Bash(systemctl --user status:*)" "Bash(journalctl --user:*)"
  )

  echo "=== daily-routine start $(date -Is) (HEAD $(git rev-parse --short HEAD)) ===" >>"$log_file"
  local status=0
  claude -p "/daily-routine" \
    --allowedTools "${allowed_tools[@]}" \
    >>"$log_file" 2>&1 || status=$?
  echo "=== daily-routine end $(date -Is) exit=$status ===" >>"$log_file"
  return "$status"
}

main "$@"
exit "$?"

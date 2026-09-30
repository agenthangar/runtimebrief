#!/bin/zsh -f
# Compatibility for the pinned, unchanged public `t open` command.
# No personal shell startup, terminal attachment, prompt keystrokes, or approvals.
umask 077
export T_LOCAL_RC=/dev/null T_NO_AUTORELOAD=1
export XDG_CONFIG_HOME="$RB_T_DIR/config" XDG_CACHE_HOME="$RB_T_DIR/cache" XDG_STATE_HOME="$RB_T_DIR/state"
export PATH="$RB_T_DIR/bin:$RB_T_HOME/bin:${RB_T_PATH}"
source "$RB_T_HOME/t.plugin.zsh" || exit 1
DEV_REPOS[$RB_T_REPO]="$RB_T_PROJECT"
# A separate root and unique numeric slot prevent collisions and human sweeps.
DEV_WORKTREE_ROOT="$RB_T_WORKTREES"
DEV_WORKTREE_DEFAULT=1
tmux() {
  case "$1" in
    attach-session) return 0 ;;
    new-session)
      # Multiple command arguments are executed directly by tmux, without a shell.
      command "$RB_T_TMUX" "$@" -e "RB_T_CONFIG=$RB_T_DIR/payload.json" -e "PATH=$PATH" /bin/zsh -f ;;
    *) command "$RB_T_TMUX" "$@" ;;
  esac
}
t open "$RB_T_REPO" "$RB_T_SLOT" --claude --local

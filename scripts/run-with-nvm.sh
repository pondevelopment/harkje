#!/usr/bin/env bash
# Sources nvm and runs the given npm script in the harkje workspace.
# Used by .vscode/tasks.json so VS Code tasks have node/npm on PATH in WSL.
set -e
export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
. "$NVM_DIR/nvm.sh"
nvm use 20.20.2 >/dev/null 2>&1 || true
exec npm "$@"

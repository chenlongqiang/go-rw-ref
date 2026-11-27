#!/usr/bin/env bash
# 发布插件到扩展市场。
#
# 用法：
#   bash scripts/publish.sh marketplace   # VS Code Marketplace（VS Code 内可搜索）
#   bash scripts/publish.sh openvsx       # Open VSX（Cursor、VSCodium 等编辑器可搜索）
#   bash scripts/publish.sh all           # 两个市场都发布
#
# 认证（任选其一，不要把令牌写进仓库）：
#   Marketplace：先执行 `npx vsce login <publisher>`，或设置环境变量 VSCE_PAT
#   Open VSX：   设置环境变量 OVSX_PAT
#
# 发布前请先修改 package.json 中的 version，同一版本号不能重复发布。
set -euo pipefail

cd "$(dirname "$0")/.."

TARGET="${1:-}"
NAME="$(node -p "require('./package.json').name")"
VERSION="$(node -p "require('./package.json').version")"
VSIX="dist/${NAME}-${VERSION}.vsix"

usage() {
  echo "用法：bash scripts/publish.sh <marketplace|openvsx|all>" >&2
  exit 2
}

publish_marketplace() {
  echo "==> 发布到 VS Code Marketplace：${VSIX}"
  npx vsce publish --packagePath "${VSIX}"
}

publish_openvsx() {
  if [[ -z "${OVSX_PAT:-}" ]]; then
    echo "错误：请先设置环境变量 OVSX_PAT（Open VSX 访问令牌）" >&2
    exit 1
  fi
  echo "==> 发布到 Open VSX：${VSIX}"
  npx ovsx publish "${VSIX}"
}

case "${TARGET}" in
  marketplace | openvsx | all) ;;
  *) usage ;;
esac

if [[ ! -f "${VSIX}" ]]; then
  bash scripts/package.sh
fi

case "${TARGET}" in
  marketplace) publish_marketplace ;;
  openvsx) publish_openvsx ;;
  all)
    publish_marketplace
    publish_openvsx
    ;;
esac

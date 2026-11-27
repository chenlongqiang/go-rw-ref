#!/usr/bin/env bash
# 打包 VSIX 安装包。
#
# 用法：
#   bash scripts/package.sh            # 产物：dist/<name>-<version>.vsix
#   CLEAN_INSTALL=1 bash scripts/package.sh   # 先用 npm ci 重新安装依赖
#
# 步骤：安装依赖（缺失时）→ 编译 → 单元测试 → vsce package。
set -euo pipefail

cd "$(dirname "$0")/.."

NAME="$(node -p "require('./package.json').name")"
VERSION="$(node -p "require('./package.json').version")"
OUT_DIR="dist"
VSIX="${OUT_DIR}/${NAME}-${VERSION}.vsix"

if [[ "${CLEAN_INSTALL:-0}" == "1" || ! -d node_modules ]]; then
  echo "==> 安装依赖 (npm ci)"
  npm ci
fi

echo "==> 编译并运行单元测试"
npm run test:unit

echo "==> 打包 ${VSIX}"
mkdir -p "${OUT_DIR}"
npx vsce package --out "${VSIX}"

echo
echo "完成：${VSIX}"
echo "本地安装：code --install-extension ${VSIX}"

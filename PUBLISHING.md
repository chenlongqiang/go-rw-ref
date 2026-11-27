# 发布指南

本插件可发布到两个公开市场：

| 市场 | 谁能搜到 | 认证方式 |
|---|---|---|
| [VS Code Marketplace](https://marketplace.visualstudio.com/) | VS Code | Microsoft 账号 + 发布者 ID |
| [Open VSX](https://open-vsx.org/) | Cursor、VSCodium、Windsurf 等 VS Code 衍生编辑器 | GitHub 账号 + Eclipse 账号 |

两个市场互相独立，建议都发布。

## 一、首次准备（只做一次）

### 1. VS Code Marketplace 发布者

1. 打开 [发布者管理页](https://marketplace.visualstudio.com/manage)，用 Microsoft 账号登录。
2. 点击 **Create publisher**，填写：
   - **ID**：唯一且**创建后不可修改**，会出现在插件地址中。
   - **Name**：在市场展示的名称。
3. 把 `package.json` 中的 `publisher` 改成你创建的 **ID**（当前为 `lukachen`，若该 ID 已被占用需换一个）。

### 2. Open VSX 命名空间（可选）

1. 用 GitHub 账号登录 [open-vsx.org](https://open-vsx.org/)。
2. [注册 Eclipse 账号](https://accounts.eclipse.org/user/register)，**GitHub Username 字段须填同一个 GitHub 账号**。
3. 在 open-vsx.org 的 [Profile](https://open-vsx.org/user-settings/profile) 页点击 **Log in with Eclipse**，然后签署 **Publisher Agreement**。
4. 在 [Access Tokens](https://open-vsx.org/user-settings/tokens) 页生成令牌。
5. 创建与 `publisher` 同名的命名空间：

```bash
npx ovsx create-namespace <publisher> -p <OVSX_PAT>
```

## 二、发布方式

### 方式 A：手动上传（最简单，适合第一次）

```bash
npm install
npm run package
```

然后在 [发布者管理页](https://marketplace.visualstudio.com/manage) 选择你的发布者 → **New extension** → **Visual Studio Code**，上传 `dist/` 下的 `.vsix` 文件。通常几分钟后即可在 VS Code 中搜索到。

### 方式 B：GitHub Actions 自动发布（推荐长期使用）

仓库自带 `.github/workflows/release.yml`，推送版本标签后会自动打包、创建 GitHub Release，并按配置发布到市场。

配置一次即可：

1. **VS Code Marketplace（无需保存令牌）**：在发布者管理页选择 **Trusted Publishing** → **Create**，填写：
   - Repository owner：`chenlongqiang`
   - Repository：`go-rw-ref`
   - Workflow：`release.yml`
   - Environment：留空

   然后在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 中新增变量 `PUBLISH_MARKETPLACE=true`。
2. **Open VSX**：在仓库 **Secrets** 中新增 `OVSX_PAT`。

之后每次发版：

```bash
npm version patch          # 0.1.0 → 0.1.1，自动提交并打 v0.1.1 标签
git push --follow-tags
```

> 提示：Marketplace 首次发布某个插件时，建议先用方式 A 手动上传一次，再启用自动发布。

### 方式 C：本地命令发布

```bash
npx vsce login <publisher>       # 按提示输入 Personal Access Token
npm run publish:marketplace

export OVSX_PAT=<Open VSX 令牌>
npm run publish:openvsx
```

Marketplace 的 Personal Access Token 需在 Azure DevOps 中创建，组织选 **All accessible organizations**，权限选 **Marketplace → Manage**。官方已不推荐此方式，优先使用方式 A 或 B。

## 三、发布前检查

- `package.json` 的 `version` 每次发布必须递增，同一版本号不能重复上传。
- `publisher` 与你在市场创建的 ID 一致。
- `npm run test:unit` 通过。
- 本地安装 `dist/*.vsix` 实测一次。

## 四、发布后

- VS Code：扩展面板搜索 `Go Read/Write References`，或访问 `https://marketplace.visualstudio.com/items?itemName=<publisher>.go-rw-references`。
- Cursor 等：在扩展面板搜索同名插件，或访问 `https://open-vsx.org/extension/<publisher>/go-rw-references`。
- 下架：在发布者管理页对插件选择 **Unpublish**（可恢复）或 **Remove**（永久删除）。

# Go Read/Write References

[English](#english) | 中文

在 VS Code 中把 Go 符号的所有引用分成 **Write References（写入）**、**Read References（读取）**、**Declaration（声明）** 三组，体验接近 GoLand 的 Find Usages。

VS Code 自带的「查找所有引用」(Find All References) 只列出位置，不区分读写。本插件把每一处引用都归入写、读或声明，一眼看清变量在哪里被修改、在哪里被读取、在哪里定义。

## 功能

- **固定三组**：写入、读取、声明；声明单独成组，不会混进写入结果里。不会再出现「其他引用 Usage」把结果吞掉的情况。
- **gopls 优先 + 语法兜底**：gopls 给出 `Read` / `Write` 时直接使用；返回 `Text` 或没有结果时按 Go 语法判定，绝不留空分类。
- **同一行精确区分**：`c.Items = append(c.Items, x)` 中左侧为写入、右侧为读取。
- **结构体字面量**：`Foo{Items: value}`、`Items: makeItems(...)`（含跨行调用）正确识别为写入。
- **在当前编辑器分组打开**：点击结果不会新开窗口，并复用预览标签页，避免标签堆积。
- **结果可信度可见**：语法兜底判定的条目标记为「启发式」。
- 一键隐藏 `_test.go`、重新查找、清空结果；右键条目可「在侧边打开」。

> 为什么需要语法兜底：gopls 对**结构体字段**的 `DocumentHighlight` 经常返回 `Text` 而不是 `Read` / `Write`。在字段引用较多的工程里 `Text` 可能占绝大多数，如果只依赖语义结果，读写分组会是空的。

## 使用

1. 在 Go 文件中，把光标放在变量、字段或函数上。
2. 按 `Option+F7`（Windows/Linux 为 `Alt+F7`），或右键选择 **Go: 查找读写引用**。
3. 在底部 **Go 读写引用** 面板查看结果。

## 判定规则

| 代码 | 分组 |
|---|---|
| `x = 1`、`x++`、`x += 1`、`obj.X = v`、`Foo{X: v}` | 写入 |
| `x := v`、字段/变量定义处 | 声明（独立分组） |
| `use(x)`、`if x > 0`、赋值右侧的 `x` | 读取 |
| 函数、类型、常量、包名的使用处 | 读取（被引用即被读取） |
| 注释中的同名文字、`*p = v` 中的 `p`、map 变量键、goto 标签 | 读取 |

`obj.Items[0] = v` 中的 `Items` 显示为读取：赋值修改的是元素，`Items` 本身只被读取，这与 gopls 的判断一致。

## 设置

| 设置项 | 默认值 | 说明 |
|---|---|---|
| `goRw.openLocation` | `activeGroup` | 点击结果的打开位置；可改为 `beside` |
| `goRw.previewMode` | `true` | 使用预览标签页，连续点击不堆积标签 |
| `goRw.preserveFocus` | `true` | 打开代码后焦点保留在结果面板 |
| `goRw.includeDeclaration` | `true` | 是否显示声明位置 |
| `goRw.hideTestFiles` | `false` | 默认是否隐藏 `_test.go` 中的引用 |
| `goRw.classificationConcurrency` | `8` | 同时进行读写判定的文件数 |

## 依赖

需要安装官方 [Go 扩展](https://marketplace.visualstudio.com/items?itemName=golang.go)，并启用 `gopls`。

## 开发

```bash
npm install
npm run test:unit                 # 编译并运行单元测试
npm run package                   # 打包到 dist/go-rw-references-<version>.vsix
code --install-extension dist/go-rw-references-<version>.vsix
```

集成测试会启动独立的 VS Code 实例，使用真实 gopls 校验读写分类：

```bash
GO_EXTENSION_DIR="$HOME/.vscode/extensions/golang.go-<版本>" \
GOPLS_PATH="$(which gopls)" \
npm run test:integration
```

也可以在自己的 Go 项目里直接跑一次读写二分校验（会启动独立 VS Code 实例并加载该项目）：

```bash
GO_EXTENSION_DIR="$HOME/.vscode/extensions/golang.go-<版本>" \
GOPLS_PATH="$(which gopls)" \
GO_RW_REAL_PROJECT=/path/to/your/go/project \
GO_RW_REAL_FILE=/path/to/your/go/project/path/to/file.go \
GO_RW_REAL_SYMBOL=Items \
GO_RW_REAL_DECL_NEEDLE='Items []string' \
npm run test:integration
```

发布流程见 [PUBLISHING.md](PUBLISHING.md)。

## 致谢

交互设计受 [Go Usage Finder](https://marketplace.visualstudio.com/items?itemName=chenyihui.go-usage-finder) 启发，本项目为独立实现。

## 许可证

[MIT](LICENSE)

---

## English

Find All References for Go in VS Code, grouped into **Write References**, **Read References** and **Declaration** — similar to GoLand's Find Usages.

- Uses gopls `DocumentHighlight` semantics when it returns `Read` / `Write`, and falls back to Go syntax rules when it returns `Text` or nothing. Every reference ends up in write, read or declaration; there is no "other" bucket.
- Distinguishes both sides of `x = f(x)` on the same line.
- Struct literal keys such as `Foo{Field: v}` (including multi-line values) are reported as writes.
- Declarations form their own group instead of being counted as writes.
- Opens results in the **active editor group** and reuses the preview tab.

**Usage:** place the cursor on a Go identifier and press `Alt+F7` (`Option+F7` on macOS), or right-click → **Go: 查找读写引用**. Requires the official Go extension with gopls.

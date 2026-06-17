# Smart Copy Tool — app（Tauri 2 + React + TypeScript）

桌面应用主线。整体说明见上一级 [`../README.md`](../README.md)，文档在 [`../docs`](../docs)。

## 常用命令

```bash
npm install          # 安装前端依赖
npm run tauri dev    # 开发调试（需 Rust 工具链）
npm run tauri build  # 打包发布
npm run build        # 仅构建/校验前端（无需 Rust）
```

运行/打包需要 Rust + MSVC Build Tools + WebView2，安装步骤见
[`../docs/05-开发构建指南.md`](../docs/05-开发构建指南.md)。

## 代码结构

- `src/` 前端：`App.tsx`（编排）、`api.ts`（命令/事件）、`types.ts`、`format.ts`、`components/`
- `src-tauri/src/` 后端：`lib.rs`（命令+并发）、`copy.rs`（复制引擎）、`verify.rs`（校验）、`model.rs`（共享结构）

## 推荐 IDE

[VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

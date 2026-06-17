# Smart Copy Tool

一个 **Windows 专用、基于 `robocopy`** 的文件迁移 / 备份桌面工具。
底层用系统自带的 `robocopy` 保证复制的稳定性（跳过、重试、断点、长路径），
上层提供一个现代化界面来管理多组复制任务。

本仓库包含两代实现：

| 目录 | 说明 |
| --- | --- |
| [`app/`](./app) | **当前主线**：Tauri 2 + React + TypeScript + Tailwind 桌面应用，编译为原生小体积 exe。 |
| [`legacy-powershell/`](./legacy-powershell) | 最初的 PowerShell + WinForms 版本（单脚本 + 启动器 exe），保留作为参考与应急方案。 |
| [`docs/`](./docs) | 设计文档、演进历程、构建指南。 |

---

## 它解决什么问题

用资源管理器拷大量文件容易**中途弹窗卡住、报错就整批停**，也没有重试和日志。
本工具用 `robocopy` 规避这些问题，并补上一个好用的界面：

- ✅ 一次配置**多组** “源 → 目标”，**可并行**执行（跨不同磁盘/网络时明显更快）。
- ✅ **多源 → 同一目标**批量模式：可**跨磁盘多次累加**选择多个源文件夹，一次性全部复制到同一目标下（各自成为独立子文件夹，互不覆盖）。
- ✅ 每个任务可单独设置 **增量 / 镜像** 模式、是否**在目标下创建源同名文件夹**。
- ✅ **实时进度条 + 速度(MB/s) + 剩余时间(ETA)**，不用盯着滚动日志。
- ✅ 复制后可选 **校验**（快速比大小 / 完整比哈希），给“确实没丢文件”一个可验证的结论。
- ✅ 任务列表支持**拖动排序、双击/按钮编辑**。
- ✅ 整套任务+参数可存成**命名预设**（如“迁移到新电脑”“每日备份”）一键切换。
- ✅ 全部完成后**系统通知 + 提示音**，窗口不会自动关闭。

> 关于“同名文件夹”：源 `D:\ai_work\desktop` + 目标 `D:\work_files`，
> 勾选后会复制成 `D:\work_files\desktop`（而不是把 desktop 里的内容直接铺到 `D:\work_files`）。

---

## 快速开始（开发 / 构建当前主线）

> 需要一次性安装 Rust 工具链与 WebView2，详见 [`docs/05-开发构建指南.md`](./docs/05-开发构建指南.md)。

```bash
cd app
npm install
npm run tauri dev     # 开发调试（热重载）
npm run tauri build   # 产出安装包 / 可执行文件到 src-tauri/target/release
```

仅验证前端（无需 Rust）：

```bash
cd app
npm install
npm run build
```

应急/零依赖方案：直接用 [`legacy-powershell/`](./legacy-powershell) 里的 PowerShell 版本，
双击 `SmartCopyTool.exe`（需与 `SmartCopyTool.ps1` 同目录）即可运行。

---

## 文档导航

- [01 · 背景与需求](./docs/01-背景与需求.md)
- [02 · 演进历程：从 PowerShell 脚本到 Tauri 应用](./docs/02-演进历程.md)
- [03 · 架构设计](./docs/03-架构设计.md)
- [04 · 功能清单与使用说明](./docs/04-功能清单.md)
- [05 · 开发与构建指南](./docs/05-开发构建指南.md)

---

## 许可证

[MIT](./LICENSE) © zzbybq

# Smart Copy Tool（PowerShell 版 · 旧）

> ℹ️ 这是最初的 PowerShell + WinForms 版本，作为应急/零依赖方案保留。
> 当前主线已重写为 Tauri 桌面应用，见上一级目录的 [`../app`](../app) 与
> [`../docs`](../docs)。本目录内文件路径均为同目录相对引用，可独立使用。

这是一个 Windows 桌面文件迁移工具，界面负责选择路径、维护多组复制任务和参数，底层使用系统自带的 `robocopy` 执行复制。

## 怎么启动

推荐：双击 `SmartCopyTool.exe`（需要和 `SmartCopyTool.ps1` 放在同一个文件夹）。
也可以双击 `Start-SmartCopyTool.cmd`，或在 PowerShell 中执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File .\SmartCopyTool.ps1
```

### 关于 exe

- `SmartCopyTool.exe` 是一个轻量启动器，双击即以无控制台窗口的方式打开界面。它本身不含程序逻辑，真正的逻辑在同目录的 `SmartCopyTool.ps1`，所以两个文件要放在一起；配置和 `logs` 也写在 exe 所在目录。
- 改过 `SmartCopyTool.ps1` 后不需要重新编译 exe，直接生效。
- 如果想要“单文件、不依赖外部 ps1”的 exe，可运行 `Build-Exe.ps1`（首次需要联网，用 `ps2exe` 把脚本整体打包进 exe）。
- 重新编译启动器 exe（无需联网）：

```bash
csc.exe -nologo -codepage:65001 -target:winexe -out:SmartCopyTool.exe -reference:System.Windows.Forms.dll Launcher.cs
```

## 默认复制策略

- 支持一次添加多组源目录和目标目录，例如 `D:\A -> \\新电脑\work_files\A1`、`D:\B -> \\新电脑\work_files\B1`。
- 默认勾选“在目标下创建源同名文件夹”：例如源 `D:\ai_work\desktop`、目标 `D:\work_files`，会复制成 `D:\work_files\desktop`，而不是把 desktop 里的内容直接铺到 `D:\work_files`。如果想要把内容直接铺到目标，取消这个勾选即可。
- 点击“开始复制”后会按任务列表顺序依次执行，每个任务单独写日志；全部完成后窗口保留在“就绪”状态，不会自动关闭。
- 使用增量复制，不会删除目标目录中已有的额外文件。
- 相同文件自动跳过，不会弹窗卡住。
- 源文件较新或不同，会复制到目标。
- 目标文件较新时默认不覆盖，避免新电脑已有资料被老电脑旧文件覆盖。
- 失败文件会自动重试，默认重试 3 次，每次间隔 5 秒。
- 开启多线程复制，默认 16 线程。
- 开启断点续传模式和大文件优化。
- 排除 `$RECYCLE.BIN`、`System Volume Information`、`.git`、`node_modules`、`thumbs.db`、`desktop.ini`。
- 完整日志写到 `logs` 文件夹。

## 建议用法

1. 选择一对源文件夹和目标文件夹，点击“添加任务”。
2. 重复添加多对目录，例如 A 源对应 A1 目标、B 源对应 B1 目标。
3. 先勾选“预演，不实际复制”，点击“开始复制”，看每个任务的命令和日志是否符合预期。
4. 确认没有问题后，取消“预演”，正式复制。
5. 如果走无线网络很慢，优先改用网线或同一个高速 Wi-Fi 6/6E 网络。
6. 如果迁移的是大量小文件，可以把线程数调到 32；如果网络或机械硬盘吃不消，降到 8。
7. 不确定时不要选“镜像同步”，它会删除每个目标目录中对应源目录不存在的文件。

## 关于“不会丢文件”

这个工具能避免普通资源管理器复制时的弹窗卡住问题，并通过 `robocopy` 的跳过、重试、断点、日志机制提高可靠性。但它不能突破网络、硬盘、权限和文件正在被占用这些物理限制。任务结束后如果退出码为 0-7，通常代表成功或只有可接受差异；8 及以上需要查看日志。

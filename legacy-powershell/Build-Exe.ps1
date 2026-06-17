# 把 SmartCopyTool.ps1 打包成 SmartCopyTool.exe
# 用法：右键“使用 PowerShell 运行”，或在 PowerShell 里执行：
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Build-Exe.ps1
#
# 说明：生成的 exe 仍依赖系统自带的 PowerShell/.NET（Win10/11 都有），
# 只是双击即开、像个独立程序。需要联网首次安装 ps2exe 模块。

$ErrorActionPreference = "Stop"
$here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $here "SmartCopyTool.ps1"
$output = Join-Path $here "SmartCopyTool.exe"

if (-not (Test-Path -LiteralPath $source)) {
    throw "找不到 $source"
}

Write-Host "检查 ps2exe 模块..."
if (-not (Get-Module -ListAvailable -Name ps2exe)) {
    Write-Host "未安装 ps2exe，正在为当前用户安装（需要联网）..."
    try {
        if (-not (Get-PackageProvider -Name NuGet -ErrorAction SilentlyContinue)) {
            Install-PackageProvider -Name NuGet -Scope CurrentUser -Force | Out-Null
        }
        Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue
        Install-Module -Name ps2exe -Scope CurrentUser -Force -AllowClobber
    } catch {
        throw "安装 ps2exe 失败：$($_.Exception.Message)。请确认网络可访问 PowerShell 库（PSGallery）。"
    }
}

Import-Module ps2exe -Force

Write-Host "开始打包：$source -> $output"
Invoke-ps2exe `
    -inputFile  $source `
    -outputFile $output `
    -noConsole `
    -STA `
    -title       "Smart Copy Tool" `
    -description "稳定迁移文件的复制工具" `
    -company     "" `
    -product     "Smart Copy Tool" `
    -version     "1.1.0"

if (Test-Path -LiteralPath $output) {
    Write-Host ""
    Write-Host "打包完成：$output"
    Write-Host "双击这个 exe 即可运行。配置和 logs 仍写在 exe 所在目录。"
} else {
    throw "打包未生成 exe，请查看上面的错误信息。"
}

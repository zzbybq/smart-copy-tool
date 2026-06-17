using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

// 轻量启动器：双击本 exe 即以无窗口方式启动同目录下的 SmartCopyTool.ps1（STA, 隐藏控制台）。
class Launcher
{
    [STAThread]
    static void Main()
    {
        try
        {
            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            string script = Path.Combine(exeDir, "SmartCopyTool.ps1");
            if (!File.Exists(script))
            {
                MessageBox.Show("找不到 SmartCopyTool.ps1，请把它和本程序放在同一个文件夹。",
                    "Smart Copy Tool", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -ExecutionPolicy Bypass -STA -File \"" + script + "\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = exeDir
            };
            Process.Start(psi);
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Smart Copy Tool 启动失败",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}

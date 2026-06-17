param()

if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
    Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-STA",
        "-File", "`"$PSCommandPath`""
    )
    exit
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"

$script:CurrentProcess = $null
$script:ActiveTask = $null
$script:LogFile = $null
$script:ConfigPath = Join-Path $PSScriptRoot "SmartCopyTool.config.json"
$script:PendingTasks = New-Object System.Collections.Queue
$script:TaskResults = New-Object System.Collections.ArrayList
$script:CurrentTaskNumber = 0
$script:TotalTaskCount = 0
$script:TaskBatchStamp = $null

function Quote-Arg {
    param([string]$Value)
    if ($null -eq $Value) { return '""' }
    return '"' + ($Value -replace '"', '\"') + '"'
}

function Split-Patterns {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return @() }
    return @($Text -split '[;,]' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Append-Log {
    param([string]$Text)

    if ($null -eq $Text) { return }
    $action = [Action[string]]{
        param($Line)
        $logBox.AppendText($Line + [Environment]::NewLine)
        $logBox.SelectionStart = $logBox.TextLength
        $logBox.ScrollToCaret()
    }

    if ($form.InvokeRequired) {
        [void]$form.BeginInvoke($action, $Text)
    } else {
        $action.Invoke($Text)
    }
}

function Set-RunningState {
    param([bool]$Running)
    $action = [Action[bool]]{
        param($IsRunning)
        $startButton.Enabled = -not $IsRunning
        $previewButton.Enabled = -not $IsRunning
        $addTaskButton.Enabled = -not $IsRunning
        $removeTaskButton.Enabled = -not $IsRunning
        $clearTasksButton.Enabled = -not $IsRunning
        $createSubfolderCheckBox.Enabled = -not $IsRunning
        $stopButton.Enabled = $IsRunning
        $sourceBrowseButton.Enabled = -not $IsRunning
        $destBrowseButton.Enabled = -not $IsRunning
        $taskListView.Enabled = -not $IsRunning
        $statusLabel.Text = if ($IsRunning) { "正在复制..." } else { "就绪" }
    }

    if ($form.InvokeRequired) {
        [void]$form.BeginInvoke($action, $Running)
    } else {
        $action.Invoke($Running)
    }
}

function New-TaskLogFile {
    param([int]$TaskNumber)

    $logDir = Join-Path $PSScriptRoot "logs"
    if (-not (Test-Path -LiteralPath $logDir)) {
        New-Item -Path $logDir -ItemType Directory | Out-Null
    }
    if ([string]::IsNullOrWhiteSpace($script:TaskBatchStamp)) {
        $script:TaskBatchStamp = Get-Date -Format "yyyyMMdd-HHmmss"
    }
    return Join-Path $logDir ("smart-copy-{0}-task{1:00}.log" -f $script:TaskBatchStamp, $TaskNumber)
}

function Build-RobocopyArgs {
    param(
        [string]$Source,
        [string]$Destination,
        [string]$LogFile
    )

    $source = $Source.Trim()
    $destination = $Destination.Trim()

    if ([string]::IsNullOrWhiteSpace($source)) {
        throw "请选择源文件夹。"
    }
    if ([string]::IsNullOrWhiteSpace($destination)) {
        throw "请选择目标文件夹。"
    }
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
        throw "源文件夹不存在：$source"
    }

    if ($createSubfolderCheckBox.Checked) {
        $leaf = Split-Path -Path ($source.TrimEnd('\', '/')) -Leaf
        if (-not [string]::IsNullOrWhiteSpace($leaf)) {
            $destination = Join-Path $destination $leaf
        }
    }

    $threads = [int]$threadsInput.Value
    $retry = [int]$retryInput.Value
    $wait = [int]$waitInput.Value
    $script:LogFile = $LogFile

    $args = New-Object System.Collections.Generic.List[string]
    [void]$args.Add($source)
    [void]$args.Add($destination)
    [void]$args.Add("*")

    if ($modeComboBox.SelectedIndex -eq 1) {
        [void]$args.Add("/MIR")
    } elseif ($includeEmptyCheckBox.Checked) {
        [void]$args.Add("/E")
    } else {
        [void]$args.Add("/S")
    }

    [void]$args.Add("/COPY:DAT")
    [void]$args.Add("/DCOPY:DAT")
    [void]$args.Add("/FFT")
    [void]$args.Add("/XJ")
    [void]$args.Add("/R:$retry")
    [void]$args.Add("/W:$wait")
    [void]$args.Add("/MT:$threads")
    [void]$args.Add("/NP")
    [void]$args.Add("/TEE")
    [void]$args.Add("/LOG+:$script:LogFile")

    if ($restartableCheckBox.Checked) { [void]$args.Add("/Z") }
    if ($unbufferedCheckBox.Checked) { [void]$args.Add("/J") }
    if ($skipOlderCheckBox.Checked) { [void]$args.Add("/XO") }
    if ($dryRunCheckBox.Checked) { [void]$args.Add("/L") }

    $excludeDirs = Split-Patterns $excludeDirsTextBox.Text
    if ($excludeDirs.Count -gt 0) {
        [void]$args.Add("/XD")
        foreach ($item in $excludeDirs) { [void]$args.Add($item) }
    }

    $excludeFiles = Split-Patterns $excludeFilesTextBox.Text
    if ($excludeFiles.Count -gt 0) {
        [void]$args.Add("/XF")
        foreach ($item in $excludeFiles) { [void]$args.Add($item) }
    }

    return @($args)
}

function Get-CopyTasks {
    $tasks = @()
    foreach ($item in $taskListView.Items) {
        $tasks += [pscustomobject]@{
            Source = [string]$item.SubItems[0].Text
            Destination = [string]$item.SubItems[1].Text
        }
    }

    if ($tasks.Count -eq 0 -and
        -not [string]::IsNullOrWhiteSpace($sourceTextBox.Text) -and
        -not [string]::IsNullOrWhiteSpace($destTextBox.Text)) {
        $tasks += [pscustomobject]@{
            Source = $sourceTextBox.Text.Trim()
            Destination = $destTextBox.Text.Trim()
        }
    }

    if ($tasks.Count -eq 0) {
        throw "请先添加至少一个复制任务。"
    }

    return @($tasks)
}

function Add-CopyTask {
    param(
        [string]$Source,
        [string]$Destination
    )

    $source = $Source.Trim()
    $destination = $Destination.Trim()
    if ([string]::IsNullOrWhiteSpace($source) -or [string]::IsNullOrWhiteSpace($destination)) {
        throw "源文件夹和目标文件夹都不能为空。"
    }

    $item = New-Object System.Windows.Forms.ListViewItem($source)
    [void]$item.SubItems.Add($destination)
    [void]$taskListView.Items.Add($item)
}

function Format-CommandLine {
    param([string[]]$ArgsList)
    $quotedArgs = $ArgsList | ForEach-Object { Quote-Arg $_ }
    return "robocopy.exe " + ($quotedArgs -join " ")
}

function Save-Config {
    $tasks = @()
    foreach ($item in $taskListView.Items) {
        $tasks += [ordered]@{
            Source = [string]$item.SubItems[0].Text
            Destination = [string]$item.SubItems[1].Text
        }
    }

    $config = [ordered]@{
        Source = $sourceTextBox.Text
        Destination = $destTextBox.Text
        Tasks = $tasks
        CreateSubfolder = $createSubfolderCheckBox.Checked
        ModeIndex = $modeComboBox.SelectedIndex
        Threads = [int]$threadsInput.Value
        Retry = [int]$retryInput.Value
        Wait = [int]$waitInput.Value
        IncludeEmpty = $includeEmptyCheckBox.Checked
        Restartable = $restartableCheckBox.Checked
        Unbuffered = $unbufferedCheckBox.Checked
        SkipOlder = $skipOlderCheckBox.Checked
        DryRun = $dryRunCheckBox.Checked
        ExcludeDirs = $excludeDirsTextBox.Text
        ExcludeFiles = $excludeFilesTextBox.Text
    }
    $config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $script:ConfigPath -Encoding UTF8
}

function Load-Config {
    if (-not (Test-Path -LiteralPath $script:ConfigPath)) { return }
    try {
        $config = Get-Content -LiteralPath $script:ConfigPath -Raw | ConvertFrom-Json
        $sourceTextBox.Text = [string]$config.Source
        $destTextBox.Text = [string]$config.Destination
        $taskListView.Items.Clear()
        if ($null -ne $config.Tasks) {
            foreach ($task in @($config.Tasks)) {
                if (-not [string]::IsNullOrWhiteSpace([string]$task.Source) -and
                    -not [string]::IsNullOrWhiteSpace([string]$task.Destination)) {
                    Add-CopyTask ([string]$task.Source) ([string]$task.Destination)
                }
            }
        }
        if ($null -ne $config.CreateSubfolder) {
            $createSubfolderCheckBox.Checked = [bool]$config.CreateSubfolder
        }
        $modeComboBox.SelectedIndex = [Math]::Max(0, [Math]::Min(1, [int]$config.ModeIndex))
        $threadsInput.Value = [Math]::Max($threadsInput.Minimum, [Math]::Min($threadsInput.Maximum, [int]$config.Threads))
        $retryInput.Value = [Math]::Max($retryInput.Minimum, [Math]::Min($retryInput.Maximum, [int]$config.Retry))
        $waitInput.Value = [Math]::Max($waitInput.Minimum, [Math]::Min($waitInput.Maximum, [int]$config.Wait))
        $includeEmptyCheckBox.Checked = [bool]$config.IncludeEmpty
        $restartableCheckBox.Checked = [bool]$config.Restartable
        $unbufferedCheckBox.Checked = [bool]$config.Unbuffered
        $skipOlderCheckBox.Checked = [bool]$config.SkipOlder
        $dryRunCheckBox.Checked = [bool]$config.DryRun
        $excludeDirsTextBox.Text = [string]$config.ExcludeDirs
        $excludeFilesTextBox.Text = [string]$config.ExcludeFiles
    } catch {
        Append-Log "读取配置失败：$($_.Exception.Message)"
    }
}

function New-Label {
    param([string]$Text, [int]$X, [int]$Y, [int]$Width = 90)
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $Text
    $label.Location = New-Object System.Drawing.Point($X, $Y)
    $label.Size = New-Object System.Drawing.Size($Width, 24)
    $label.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    return $label
}

function New-TextBox {
    param([int]$X, [int]$Y, [int]$Width, [string]$Text = "")
    $textBox = New-Object System.Windows.Forms.TextBox
    $textBox.Location = New-Object System.Drawing.Point($X, $Y)
    $textBox.Size = New-Object System.Drawing.Size($Width, 24)
    $textBox.Text = $Text
    return $textBox
}

function Select-Folder {
    param([System.Windows.Forms.TextBox]$TargetTextBox)
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "选择文件夹"
    $dialog.ShowNewFolderButton = $true
    if (-not [string]::IsNullOrWhiteSpace($TargetTextBox.Text)) {
        $dialog.SelectedPath = $TargetTextBox.Text
    }
    if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
        $TargetTextBox.Text = $dialog.SelectedPath
    }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Smart Copy Tool - 稳定迁移文件"
$form.Size = New-Object System.Drawing.Size(980, 800)
$form.StartPosition = "CenterScreen"
$form.MinimumSize = New-Object System.Drawing.Size(900, 720)
$form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)

$sourceLabel = New-Label "源文件夹" 16 18
$sourceTextBox = New-TextBox 108 18 730
$sourceBrowseButton = New-Object System.Windows.Forms.Button
$sourceBrowseButton.Text = "选择..."
$sourceBrowseButton.Location = New-Object System.Drawing.Point(852, 16)
$sourceBrowseButton.Size = New-Object System.Drawing.Size(100, 28)
$sourceBrowseButton.Add_Click({ Select-Folder $sourceTextBox })

$destLabel = New-Label "目标文件夹" 16 56
$destTextBox = New-TextBox 108 56 730
$destBrowseButton = New-Object System.Windows.Forms.Button
$destBrowseButton.Text = "选择..."
$destBrowseButton.Location = New-Object System.Drawing.Point(852, 54)
$destBrowseButton.Size = New-Object System.Drawing.Size(100, 28)
$destBrowseButton.Add_Click({ Select-Folder $destTextBox })

$addTaskButton = New-Object System.Windows.Forms.Button
$addTaskButton.Text = "添加任务"
$addTaskButton.Location = New-Object System.Drawing.Point(108, 92)
$addTaskButton.Size = New-Object System.Drawing.Size(110, 30)

$removeTaskButton = New-Object System.Windows.Forms.Button
$removeTaskButton.Text = "删除选中"
$removeTaskButton.Location = New-Object System.Drawing.Point(232, 92)
$removeTaskButton.Size = New-Object System.Drawing.Size(110, 30)

$clearTasksButton = New-Object System.Windows.Forms.Button
$clearTasksButton.Text = "清空任务"
$clearTasksButton.Location = New-Object System.Drawing.Point(356, 92)
$clearTasksButton.Size = New-Object System.Drawing.Size(110, 30)

$createSubfolderCheckBox = New-Object System.Windows.Forms.CheckBox
$createSubfolderCheckBox.Text = "在目标下创建源同名文件夹（推荐）"
$createSubfolderCheckBox.Location = New-Object System.Drawing.Point(486, 94)
$createSubfolderCheckBox.Size = New-Object System.Drawing.Size(260, 26)
$createSubfolderCheckBox.Checked = $true

$taskLabel = New-Label "任务列表" 16 132
$taskListView = New-Object System.Windows.Forms.ListView
$taskListView.Location = New-Object System.Drawing.Point(108, 132)
$taskListView.Size = New-Object System.Drawing.Size(844, 110)
$taskListView.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$taskListView.View = [System.Windows.Forms.View]::Details
$taskListView.FullRowSelect = $true
$taskListView.GridLines = $true
$taskListView.MultiSelect = $true
[void]$taskListView.Columns.Add("源文件夹", 400)
[void]$taskListView.Columns.Add("目标文件夹", 420)

$modeLabel = New-Label "复制模式" 16 264
$modeComboBox = New-Object System.Windows.Forms.ComboBox
$modeComboBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$modeComboBox.Location = New-Object System.Drawing.Point(108, 263)
$modeComboBox.Size = New-Object System.Drawing.Size(260, 24)
[void]$modeComboBox.Items.Add("增量复制：复制新增/变化文件，保留目标多余文件")
[void]$modeComboBox.Items.Add("镜像同步：目标完全跟随源，会删除目标多余文件")
$modeComboBox.SelectedIndex = 0

$threadsLabel = New-Label "并发线程" 392 264 70
$threadsInput = New-Object System.Windows.Forms.NumericUpDown
$threadsInput.Location = New-Object System.Drawing.Point(464, 263)
$threadsInput.Size = New-Object System.Drawing.Size(70, 24)
$threadsInput.Minimum = 1
$threadsInput.Maximum = 128
$threadsInput.Value = 16

$retryLabel = New-Label "重试次数" 556 264 70
$retryInput = New-Object System.Windows.Forms.NumericUpDown
$retryInput.Location = New-Object System.Drawing.Point(628, 263)
$retryInput.Size = New-Object System.Drawing.Size(70, 24)
$retryInput.Minimum = 0
$retryInput.Maximum = 999
$retryInput.Value = 3

$waitLabel = New-Label "重试间隔秒" 720 264 82
$waitInput = New-Object System.Windows.Forms.NumericUpDown
$waitInput.Location = New-Object System.Drawing.Point(804, 263)
$waitInput.Size = New-Object System.Drawing.Size(70, 24)
$waitInput.Minimum = 0
$waitInput.Maximum = 3600
$waitInput.Value = 5

$includeEmptyCheckBox = New-Object System.Windows.Forms.CheckBox
$includeEmptyCheckBox.Text = "复制空文件夹"
$includeEmptyCheckBox.Location = New-Object System.Drawing.Point(108, 302)
$includeEmptyCheckBox.Size = New-Object System.Drawing.Size(120, 24)
$includeEmptyCheckBox.Checked = $true

$restartableCheckBox = New-Object System.Windows.Forms.CheckBox
$restartableCheckBox.Text = "断点续传模式"
$restartableCheckBox.Location = New-Object System.Drawing.Point(246, 302)
$restartableCheckBox.Size = New-Object System.Drawing.Size(120, 24)
$restartableCheckBox.Checked = $true

$unbufferedCheckBox = New-Object System.Windows.Forms.CheckBox
$unbufferedCheckBox.Text = "大文件优化"
$unbufferedCheckBox.Location = New-Object System.Drawing.Point(384, 302)
$unbufferedCheckBox.Size = New-Object System.Drawing.Size(110, 24)
$unbufferedCheckBox.Checked = $true

$skipOlderCheckBox = New-Object System.Windows.Forms.CheckBox
$skipOlderCheckBox.Text = "目标较新时不覆盖"
$skipOlderCheckBox.Location = New-Object System.Drawing.Point(512, 302)
$skipOlderCheckBox.Size = New-Object System.Drawing.Size(145, 24)
$skipOlderCheckBox.Checked = $true

$dryRunCheckBox = New-Object System.Windows.Forms.CheckBox
$dryRunCheckBox.Text = "预演，不实际复制"
$dryRunCheckBox.Location = New-Object System.Drawing.Point(675, 302)
$dryRunCheckBox.Size = New-Object System.Drawing.Size(150, 24)
$dryRunCheckBox.Checked = $false

$excludeDirsLabel = New-Label "排除文件夹" 16 342
$excludeDirsTextBox = New-TextBox 108 342 844 '$RECYCLE.BIN;System Volume Information;.git;node_modules'

$excludeFilesLabel = New-Label "排除文件" 16 380
$excludeFilesTextBox = New-TextBox 108 380 844 'thumbs.db;desktop.ini'

$previewButton = New-Object System.Windows.Forms.Button
$previewButton.Text = "预览命令"
$previewButton.Location = New-Object System.Drawing.Point(108, 422)
$previewButton.Size = New-Object System.Drawing.Size(110, 32)

$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = "开始复制"
$startButton.Location = New-Object System.Drawing.Point(232, 422)
$startButton.Size = New-Object System.Drawing.Size(110, 32)

$stopButton = New-Object System.Windows.Forms.Button
$stopButton.Text = "停止"
$stopButton.Location = New-Object System.Drawing.Point(356, 422)
$stopButton.Size = New-Object System.Drawing.Size(110, 32)
$stopButton.Enabled = $false

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = "就绪"
$statusLabel.Location = New-Object System.Drawing.Point(488, 427)
$statusLabel.Size = New-Object System.Drawing.Size(390, 24)
$statusLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft

$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Location = New-Object System.Drawing.Point(16, 474)
$logBox.Size = New-Object System.Drawing.Size(936, 250)
$logBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Bottom -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$logBox.Multiline = $true
$logBox.ScrollBars = [System.Windows.Forms.ScrollBars]::Both
$logBox.ReadOnly = $true
$logBox.WordWrap = $false
$logBox.Font = New-Object System.Drawing.Font("Consolas", 9)

$hintLabel = New-Object System.Windows.Forms.Label
$hintLabel.Text = "先选择一对源/目标并添加任务；可以添加多对目录后一次执行。完整日志保存在当前目录的 logs 文件夹。"
$hintLabel.Location = New-Object System.Drawing.Point(16, 736)
$hintLabel.Size = New-Object System.Drawing.Size(936, 22)
$hintLabel.Anchor = [System.Windows.Forms.AnchorStyles]::Bottom -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right

$form.Controls.AddRange(@(
    $sourceLabel, $sourceTextBox, $sourceBrowseButton,
    $destLabel, $destTextBox, $destBrowseButton,
    $addTaskButton, $removeTaskButton, $clearTasksButton, $createSubfolderCheckBox,
    $taskLabel, $taskListView,
    $modeLabel, $modeComboBox, $threadsLabel, $threadsInput,
    $retryLabel, $retryInput, $waitLabel, $waitInput,
    $includeEmptyCheckBox, $restartableCheckBox, $unbufferedCheckBox,
    $skipOlderCheckBox, $dryRunCheckBox,
    $excludeDirsLabel, $excludeDirsTextBox,
    $excludeFilesLabel, $excludeFilesTextBox,
    $previewButton, $startButton, $stopButton, $statusLabel,
    $logBox, $hintLabel
))

$addTaskButton.Add_Click({
    try {
        Add-CopyTask $sourceTextBox.Text $destTextBox.Text
        Save-Config
    } catch {
        [System.Windows.Forms.MessageBox]::Show($form, $_.Exception.Message, "无法添加任务", "OK", "Warning") | Out-Null
    }
})

$removeTaskButton.Add_Click({
    foreach ($item in @($taskListView.SelectedItems)) {
        $taskListView.Items.Remove($item)
    }
    try { Save-Config } catch {}
})

$clearTasksButton.Add_Click({
    if ($taskListView.Items.Count -eq 0) { return }
    $result = [System.Windows.Forms.MessageBox]::Show(
        $form,
        "确认清空任务列表？",
        "确认清空",
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question
    )
    if ($result -eq [System.Windows.Forms.DialogResult]::Yes) {
        $taskListView.Items.Clear()
        try { Save-Config } catch {}
    }
})

$taskListView.Add_DoubleClick({
    if ($taskListView.SelectedItems.Count -eq 0) { return }
    $item = $taskListView.SelectedItems[0]
    $sourceTextBox.Text = $item.SubItems[0].Text
    $destTextBox.Text = $item.SubItems[1].Text
})

function Finish-CurrentTask {
    # Runs on the UI thread (from the timer). Records the result of the
    # process that just exited.
    $process = $script:CurrentProcess
    if ($null -eq $process) { return }

    try { $process.WaitForExit() } catch {}
    $exitCode = try { $process.ExitCode } catch { 999 }
    $success = $exitCode -le 7
    $finishedTask = $script:ActiveTask

    Append-Log "结束时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    Append-Log "Robocopy 退出码：$exitCode（0-7 通常表示成功或仅有可接受差异，8 及以上表示失败）"
    if ($success) {
        Append-Log ("任务 {0}/{1} 完成。" -f $script:CurrentTaskNumber, $script:TotalTaskCount)
    } else {
        Append-Log ("任务 {0}/{1} 失败，将继续执行后续任务。" -f $script:CurrentTaskNumber, $script:TotalTaskCount)
    }
    [void]$script:TaskResults.Add([pscustomobject]@{
        TaskNumber = $script:CurrentTaskNumber
        Source = $finishedTask.Source
        Destination = $finishedTask.Destination
        ExitCode = $exitCode
        Success = $success
        LogFile = $script:LogFile
    })

    try { $process.Dispose() } catch {}
    $script:CurrentProcess = $null
    $script:ActiveTask = $null
}

function Finish-AllTasks {
    $script:QueueTimer.Stop()
    Append-Log ""
    Append-Log "全部任务结束：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    $failed = @($script:TaskResults | Where-Object { -not $_.Success })
    $succeeded = @($script:TaskResults | Where-Object { $_.Success })
    Append-Log ("汇总：成功 {0} 个，失败 {1} 个。" -f $succeeded.Count, $failed.Count)
    foreach ($result in $failed) {
        Append-Log ("失败：任务 {0}，退出码 {1}，源 {2} -> 目标 {3}，日志 {4}" -f $result.TaskNumber, $result.ExitCode, $result.Source, $result.Destination, $result.LogFile)
    }
    Set-RunningState $false
    $script:CurrentProcess = $null
    $script:ActiveTask = $null
}

function Start-OneCopyTask {
    # Starts the next queued task. Returns $true if a task was started,
    # $false if the queue is empty.
    if ($script:PendingTasks.Count -eq 0) { return $false }

    $script:CurrentTaskNumber++
    $task = $script:PendingTasks.Dequeue()
    $script:ActiveTask = $task
    $taskNumber = $script:CurrentTaskNumber
    $logFile = New-TaskLogFile $taskNumber

    try {
        $argsList = Build-RobocopyArgs $task.Source $task.Destination $logFile
    } catch {
        Append-Log ""
        Append-Log ("任务 {0}/{1} 参数错误：{2}" -f $taskNumber, $script:TotalTaskCount, $_.Exception.Message)
        [void]$script:TaskResults.Add([pscustomobject]@{
            TaskNumber = $taskNumber
            Source = $task.Source
            Destination = $task.Destination
            ExitCode = 999
            Success = $false
            LogFile = $logFile
        })
        $script:ActiveTask = $null
        # Skip this one; signal "started" so the timer keeps draining the queue.
        return $true
    }

    Append-Log ""
    Append-Log ("任务 {0}/{1} 开始：{2} -> {3}" -f $taskNumber, $script:TotalTaskCount, $task.Source, $task.Destination)
    Append-Log "开始时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    Append-Log "命令：$(Format-CommandLine $argsList)"
    Append-Log "日志文件：$logFile"
    $statusLabel.Text = ("正在复制 {0}/{1}..." -f $taskNumber, $script:TotalTaskCount)

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "robocopy.exe"
    $psi.Arguments = (($argsList | ForEach-Object { Quote-Arg $_ }) -join " ")
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::Default
    $psi.StandardErrorEncoding = [System.Text.Encoding]::Default

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi

    $process.add_OutputDataReceived({
        param($sender, $eventArgs)
        if (-not [string]::IsNullOrWhiteSpace($eventArgs.Data)) {
            Append-Log $eventArgs.Data
        }
    })
    $process.add_ErrorDataReceived({
        param($sender, $eventArgs)
        if (-not [string]::IsNullOrWhiteSpace($eventArgs.Data)) {
            Append-Log $eventArgs.Data
        }
    })

    $script:CurrentProcess = $process
    [void]$process.Start()
    $process.BeginOutputReadLine()
    $process.BeginErrorReadLine()
    return $true
}

$script:QueueTimer = New-Object System.Windows.Forms.Timer
$script:QueueTimer.Interval = 400
$script:QueueTimer.Add_Tick({
    # Driven on the UI thread, so no cross-thread reentrancy issues.
    if ($null -ne $script:CurrentProcess) {
        if (-not $script:CurrentProcess.HasExited) { return }  # still running
        Finish-CurrentTask
    }

    if ($script:PendingTasks.Count -eq 0) {
        Finish-AllTasks
        return
    }

    if (-not (Start-OneCopyTask)) {
        Finish-AllTasks
    }
})

$previewButton.Add_Click({
    try {
        $tasks = @(Get-CopyTasks)
        $script:TaskBatchStamp = Get-Date -Format "yyyyMMdd-HHmmss"
        Append-Log "命令预览："
        $index = 0
        foreach ($task in $tasks) {
            $index++
            $logFile = New-TaskLogFile $index
            $argsList = Build-RobocopyArgs $task.Source $task.Destination $logFile
            Append-Log ("任务 {0}: {1} -> {2}" -f $index, $task.Source, $task.Destination)
            Append-Log (Format-CommandLine $argsList)
            Append-Log "日志文件：$logFile"
        }
        $script:TaskBatchStamp = $null
    } catch {
        [System.Windows.Forms.MessageBox]::Show($form, $_.Exception.Message, "无法生成命令", "OK", "Warning") | Out-Null
    }
})

$startButton.Add_Click({
    try {
        if ($modeComboBox.SelectedIndex -eq 1) {
            $result = [System.Windows.Forms.MessageBox]::Show(
                $form,
                "镜像同步会删除目标文件夹中源文件夹没有的内容。确认继续？",
                "确认镜像同步",
                [System.Windows.Forms.MessageBoxButtons]::YesNo,
                [System.Windows.Forms.MessageBoxIcon]::Warning
            )
            if ($result -ne [System.Windows.Forms.DialogResult]::Yes) { return }
        }

        Save-Config
        $tasks = @(Get-CopyTasks)
        $logBox.Clear()
        $script:PendingTasks = New-Object System.Collections.Queue
        foreach ($task in $tasks) {
            $script:PendingTasks.Enqueue($task)
        }
        $script:TaskResults = New-Object System.Collections.ArrayList
        $script:CurrentTaskNumber = 0
        $script:TotalTaskCount = $tasks.Count
        $script:TaskBatchStamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $script:CurrentProcess = $null
        $script:ActiveTask = $null
        Append-Log "队列开始：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')，共 $($tasks.Count) 个任务。"
        Set-RunningState $true
        $script:QueueTimer.Start()
    } catch {
        Set-RunningState $false
        [System.Windows.Forms.MessageBox]::Show($form, $_.Exception.Message, "启动失败", "OK", "Error") | Out-Null
    }
})

$stopButton.Add_Click({
    try {
        $script:QueueTimer.Stop()
        $script:PendingTasks.Clear()
        if ($null -ne $script:CurrentProcess -and -not $script:CurrentProcess.HasExited) {
            $script:CurrentProcess.Kill()
            Append-Log "用户已停止复制进程。"
        }
    } catch {
        Append-Log "停止失败：$($_.Exception.Message)"
    } finally {
        $script:CurrentProcess = $null
        $script:ActiveTask = $null
        Set-RunningState $false
    }
})

$form.Add_FormClosing({
    param($sender, $eventArgs)
    if ($null -ne $script:CurrentProcess -and -not $script:CurrentProcess.HasExited) {
        $result = [System.Windows.Forms.MessageBox]::Show(
            $form,
            "复制任务仍在运行，关闭窗口会停止任务。确认关闭？",
            "确认关闭",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )
        if ($result -ne [System.Windows.Forms.DialogResult]::Yes) {
            $eventArgs.Cancel = $true
            return
        }
        $script:QueueTimer.Stop()
        $script:PendingTasks.Clear()
        $script:CurrentProcess.Kill()
    }
    try { Save-Config } catch {}
})

Load-Config
[void]$form.ShowDialog()

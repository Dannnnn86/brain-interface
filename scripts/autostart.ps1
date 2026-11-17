# autostart.ps1 — manage the "BrainInterfaceServer" scheduled task.
#
#   powershell -File scripts/autostart.ps1 -Action install
#   powershell -File scripts/autostart.ps1 -Action remove
#   powershell -File scripts/autostart.ps1 -Action start
#   powershell -File scripts/autostart.ps1 -Action stop
#   powershell -File scripts/autostart.ps1 -Action status
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('install', 'remove', 'start', 'stop', 'status')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'
$taskName = 'BrainInterfaceServer'
$vbs = Join-Path $PSScriptRoot 'start-server.vbs'

switch ($Action) {
  'install' {
    $action_ = New-ScheduledTaskAction -Execute 'C:\Windows\System32\wscript.exe' -Argument "`"$vbs`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $settings = New-ScheduledTaskSettingsSet `
      -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
      -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName $taskName -Action $action_ -Trigger $trigger `
      -Settings $settings -Force | Out-Null
    Write-Output "installed: $taskName starts hidden at logon (30s delay not set; restarts up to 3x on crash)"
  }
  'remove' {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Output "removed: $taskName"
  }
  'start' {
    Start-ScheduledTask -TaskName $taskName
    Write-Output "started: $taskName"
  }
  'stop' {
    Stop-ScheduledTask -TaskName $taskName
    Write-Output "stopped: $taskName (note: the node child may need a manual kill: Get-NetTCPConnection -LocalPort 3030)"
  }
  'status' {
    Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State | Format-Table
    $c = Get-NetTCPConnection -State Listen -LocalPort 3030 -ErrorAction SilentlyContinue
    if ($c) { Write-Output "server: LISTENING on :3030 (pid $($c.OwningProcess))" }
    else { Write-Output 'server: not listening' }
  }
}

# Registers the "FinTechPulse Worker" scheduled task for the current Windows account.
#
# The task starts the worker daemon hidden when the owner signs in, never starts a second copy,
# restarts it within a minute if it stops, and has no run-time limit. It runs without elevated
# privileges under the account that owns the Codex and Claude Code sign-ins. Re-running this script
# replaces the task. Remove it with: Unregister-ScheduledTask -TaskName 'FinTechPulse Worker'
$ErrorActionPreference = 'Stop'

$taskName = 'FinTechPulse Worker'
$script = Join-Path $PSScriptRoot 'run-worker.ps1'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$user = "$env:USERDOMAIN\$env:USERNAME"

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" `
  -WorkingDirectory $repository
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Principal $principal -Description 'Runs the FinTechPulse local worker (pnpm worker:start).' -Force | Out-Null
Write-Output "Registered '$taskName' for $user."

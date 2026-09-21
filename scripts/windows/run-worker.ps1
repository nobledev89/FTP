# Runs the FinTechPulse worker daemon for Windows Task Scheduler (docs/HERMES.md).
#
# Output goes to %LOCALAPPDATA%\FinTechPulse\logs\worker.log, which is rotated at start-up once it
# passes 20 MB. The log holds redacted operational metadata only, and stays in the owner's profile.
$ErrorActionPreference = 'Continue'

$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logDirectory = Join-Path $env:LOCALAPPDATA 'FinTechPulse\logs'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$log = Join-Path $logDirectory 'worker.log'
if ((Test-Path -LiteralPath $log) -and ((Get-Item -LiteralPath $log).Length -gt 20MB)) {
  Move-Item -Force -LiteralPath $log -Destination "$log.1"
}

Set-Location -LiteralPath $repository

# A clean stop (exit 0, after Ctrl+C or a shutdown signal) ends the task. Anything else, such as a
# network outage at start-up or a crash, restarts the worker after a minute.
while ($true) {
  "$(Get-Date -Format o) run-worker: starting pnpm worker:start" | Out-File -Append -Encoding utf8 -FilePath $log
  pnpm worker:start 2>&1 | ForEach-Object { "$_" } | Out-File -Append -Encoding utf8 -FilePath $log
  $code = $LASTEXITCODE
  "$(Get-Date -Format o) run-worker: worker exited with code $code" | Out-File -Append -Encoding utf8 -FilePath $log
  if ($code -eq 0) { exit 0 }
  Start-Sleep -Seconds 60
}

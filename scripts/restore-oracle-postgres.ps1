param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,

  [string]$User = "opc",

  [Parameter(Mandatory = $true)]
  [string]$KeyPath,

  [Parameter(Mandatory = $true)]
  [string]$BackupFile,

  [string]$RemoteProjectDir = "/opt/ytmonitor",
  [string]$ComposeFile = "docker-compose.oracle.yml",
  [string]$DbUser = "ytbot",
  [string]$DbName = "ytbot",

  [switch]$ConfirmRestore
)

$ErrorActionPreference = "Stop"

function Get-OpenSshTool {
  param([string]$Name)

  $windowsPath = Join-Path $env:WINDIR "System32\OpenSSH\$Name.exe"
  if (Test-Path $windowsPath) {
    return $windowsPath
  }

  return $Name
}

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$ErrorMessage
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw $ErrorMessage
  }
}

if (!$ConfirmRestore) {
  throw "Restore is destructive. Re-run with -ConfirmRestore when you are sure."
}

if (!(Test-Path $KeyPath)) {
  throw "SSH key was not found: $KeyPath"
}

if (!(Test-Path $BackupFile)) {
  throw "Backup file was not found: $BackupFile"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$remoteFile = "/tmp/ytbot-restore-$timestamp.dump"
$containerFile = "/tmp/ytbot-restore.dump"
$target = "$User@$HostName"
$ssh = Get-OpenSshTool "ssh"
$scp = Get-OpenSshTool "scp"

Write-Host "Uploading backup to $HostName..."
Invoke-Checked `
  -FilePath $scp `
  -Arguments @("-i", $KeyPath, "-o", "UserKnownHostsFile=NUL", "-o", "StrictHostKeyChecking=no", $BackupFile, "${target}:$remoteFile") `
  -ErrorMessage "Backup upload failed."

$remoteCommand = "cd '$RemoteProjectDir' && sudo docker compose -f '$ComposeFile' cp '$remoteFile' postgres:'$containerFile' && sudo docker compose -f '$ComposeFile' exec -T postgres pg_restore -U '$DbUser' -d '$DbName' --clean --if-exists '$containerFile' && sudo docker compose -f '$ComposeFile' exec -T postgres rm -f '$containerFile' && rm -f '$remoteFile'"

Write-Host "Restoring PostgreSQL backup. This may take a while..."
Invoke-Checked `
  -FilePath $ssh `
  -Arguments @("-i", $KeyPath, "-o", "UserKnownHostsFile=NUL", "-o", "StrictHostKeyChecking=no", $target, $remoteCommand) `
  -ErrorMessage "Remote pg_restore failed."

Write-Host "Restore complete."

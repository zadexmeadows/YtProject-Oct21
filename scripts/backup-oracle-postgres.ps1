param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,

  [string]$User = "opc",

  [Parameter(Mandatory = $true)]
  [string]$KeyPath,

  [string]$RemoteProjectDir = "/opt/ytmonitor",
  [string]$ComposeFile = "docker-compose.oracle.yml",
  [string]$DbUser = "ytbot",
  [string]$DbName = "ytbot",
  [string]$OutputDir = (Join-Path (Get-Location) "backups"),
  [switch]$KeepRemoteCopy
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

if (!(Test-Path $KeyPath)) {
  throw "SSH key was not found: $KeyPath"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$remoteFile = "/tmp/ytbot-postgres-$timestamp.dump"
$localFile = Join-Path $OutputDir "ytbot-postgres-$timestamp.dump"
$target = "$User@$HostName"
$ssh = Get-OpenSshTool "ssh"
$scp = Get-OpenSshTool "scp"

$remoteCommand = "cd '$RemoteProjectDir' && sudo docker compose -f '$ComposeFile' exec -T postgres pg_dump -U '$DbUser' -d '$DbName' -Fc > '$remoteFile'"

Write-Host "Creating PostgreSQL backup on $HostName..."
Invoke-Checked `
  -FilePath $ssh `
  -Arguments @("-i", $KeyPath, "-o", "UserKnownHostsFile=NUL", "-o", "StrictHostKeyChecking=no", $target, $remoteCommand) `
  -ErrorMessage "Remote pg_dump failed."

Write-Host "Downloading backup to $localFile..."
Invoke-Checked `
  -FilePath $scp `
  -Arguments @("-i", $KeyPath, "-o", "UserKnownHostsFile=NUL", "-o", "StrictHostKeyChecking=no", "${target}:$remoteFile", $localFile) `
  -ErrorMessage "Backup download failed."

if (!$KeepRemoteCopy) {
  Invoke-Checked `
    -FilePath $ssh `
    -Arguments @("-i", $KeyPath, "-o", "UserKnownHostsFile=NUL", "-o", "StrictHostKeyChecking=no", $target, "rm -f '$remoteFile'") `
    -ErrorMessage "Could not remove remote temporary backup."
}

$hash = Get-FileHash -Algorithm SHA256 $localFile

Write-Host ""
Write-Host "Backup complete."
Write-Host "File: $localFile"
Write-Host "SHA256: $($hash.Hash)"

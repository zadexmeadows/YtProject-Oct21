param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,

  [string]$User = "opc",

  [Parameter(Mandatory = $true)]
  [string]$KeyPath,

  [string]$RemoteProjectDir = "/opt/ytmonitor",
  [string]$OutputDir = (Join-Path (Get-Location) "backups"),
  [switch]$IncludeSecrets,
  [switch]$IncludeExports
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

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $OutputDir "oracle-config-$timestamp"
$target = "$User@$HostName"
$ssh = Get-OpenSshTool "ssh"
$scp = Get-OpenSshTool "scp"

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$files = @("docker-compose.oracle.yml", "Caddyfile")
if ($IncludeSecrets) {
  $files += ".env"
}

foreach ($file in $files) {
  Write-Host "Downloading $file..."
  Invoke-Checked `
    -FilePath $scp `
    -Arguments @("-i", $KeyPath, "-o", "UserKnownHostsFile=NUL", "-o", "StrictHostKeyChecking=no", "${target}:$RemoteProjectDir/$file", (Join-Path $backupDir $file)) `
    -ErrorMessage "Could not download $file."
}

if ($IncludeExports) {
  $remoteArchive = "/tmp/ytbot-exports-$timestamp.tar.gz"
  $localArchive = Join-Path $backupDir "exports-$timestamp.tar.gz"
  $remoteCommand = "cd '$RemoteProjectDir' && tar -czf '$remoteArchive' storage/exports"

  Write-Host "Creating export archive..."
  Invoke-Checked `
    -FilePath $ssh `
    -Arguments @("-i", $KeyPath, "-o", "UserKnownHostsFile=NUL", "-o", "StrictHostKeyChecking=no", $target, $remoteCommand) `
    -ErrorMessage "Remote export archive failed."

  Write-Host "Downloading export archive..."
  Invoke-Checked `
    -FilePath $scp `
    -Arguments @("-i", $KeyPath, "-o", "UserKnownHostsFile=NUL", "-o", "StrictHostKeyChecking=no", "${target}:$remoteArchive", $localArchive) `
    -ErrorMessage "Export archive download failed."

  Invoke-Checked `
    -FilePath $ssh `
    -Arguments @("-i", $KeyPath, "-o", "UserKnownHostsFile=NUL", "-o", "StrictHostKeyChecking=no", $target, "rm -f '$remoteArchive'") `
    -ErrorMessage "Could not remove remote temporary export archive."
}

Write-Host ""
Write-Host "Config backup complete."
Write-Host "Folder: $backupDir"
if ($IncludeSecrets) {
  Write-Host "Warning: this folder contains secrets from .env. Store it in a password manager or encrypted drive."
} else {
  Write-Host "Note: .env was not included. Run again with -IncludeSecrets for a full restore kit."
}

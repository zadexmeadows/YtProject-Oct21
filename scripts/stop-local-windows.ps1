$ErrorActionPreference = 'Continue'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$PostgresDataDir = Join-Path $ProjectRoot 'storage\postgres-data'

function Get-ScoopAppDir {
  param([Parameter(Mandatory = $true)][string]$Name)

  $appRoot = Join-Path $env:USERPROFILE "scoop\apps\$Name"
  $current = Join-Path $appRoot 'current'
  if (Test-Path $current) {
    return (Resolve-Path $current).Path
  }

  return (Get-ChildItem $appRoot -Directory |
    Where-Object { $_.Name -ne 'current' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1).FullName
}

$projectProcesses = Get-CimInstance Win32_Process |
  Where-Object {
    ($_.Name -in @('node.exe', 'cmd.exe')) -and
    ($_.CommandLine -like "*$ProjectRoot*") -and
    ($_.CommandLine -notlike '*postgres.exe*')
  }

$projectProcesses | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

try {
  $redisDir = Get-ScoopAppDir 'redis'
  & (Join-Path $redisDir 'redis-cli.exe') -p 6379 shutdown
}
catch {
  Write-Host 'Redis was not running or could not be stopped.'
}

try {
  $pgDir = Get-ScoopAppDir 'postgresql'
  $pgCtl = Join-Path $pgDir 'bin\pg_ctl.exe'
  if (Test-Path (Join-Path $PostgresDataDir 'PG_VERSION')) {
    & $pgCtl -D $PostgresDataDir stop -m fast
  }
}
catch {
  Write-Host 'PostgreSQL was not running or could not be stopped.'
}

Write-Host 'Local YTbot services stopped.'

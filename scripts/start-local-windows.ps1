param(
  [switch]$SkipApp
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$StorageDir = Join-Path $ProjectRoot 'storage'
$PostgresDataDir = Join-Path $StorageDir 'postgres-data'
$RedisDataDir = Join-Path $StorageDir 'redis-data'

function Get-ScoopAppDir {
  param([Parameter(Mandatory = $true)][string]$Name)

  $appRoot = Join-Path $env:USERPROFILE "scoop\apps\$Name"
  if (-not (Test-Path $appRoot)) {
    throw "Scoop app '$Name' was not found. Install it with: scoop install $Name"
  }

  $current = Join-Path $appRoot 'current'
  if (Test-Path $current) {
    return (Resolve-Path $current).Path
  }

  $versionDir = Get-ChildItem $appRoot -Directory |
    Where-Object { $_.Name -ne 'current' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $versionDir) {
    throw "No usable Scoop install found for '$Name'."
  }

  return $versionDir.FullName
}

function Test-CommandSuccess {
  param([scriptblock]$Command)

  & $Command | Out-Null
  return $LASTEXITCODE -eq 0
}

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @()
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

function Stop-ProjectAppProcesses {
  $projectProcesses = Get-CimInstance Win32_Process |
    Where-Object {
      ($_.Name -in @('node.exe', 'cmd.exe')) -and
      ($_.CommandLine -like "*$ProjectRoot*") -and
      ($_.CommandLine -notlike '*postgres.exe*')
    }

  $projectProcesses | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

Stop-ProjectAppProcesses

$pgDir = Get-ScoopAppDir 'postgresql'
$pgBin = Join-Path $pgDir 'bin'
$redisDir = Get-ScoopAppDir 'redis'
$redisServer = Join-Path $redisDir 'redis-server.exe'
$redisCli = Join-Path $redisDir 'redis-cli.exe'

New-Item -ItemType Directory -Force -Path $StorageDir, $PostgresDataDir, $RedisDataDir | Out-Null

if (-not (Test-Path (Join-Path $PostgresDataDir 'PG_VERSION'))) {
  & (Join-Path $pgBin 'initdb.exe') -D $PostgresDataDir --username=ytbot --auth=trust --encoding=UTF8 --locale=C
}

$pgReady = Test-CommandSuccess { & (Join-Path $pgBin 'pg_isready.exe') -h localhost -p 5432 -U ytbot }
if (-not $pgReady) {
  & (Join-Path $pgBin 'pg_ctl.exe') -D $PostgresDataDir -l (Join-Path $StorageDir 'postgres.log') -o "-p 5432" start
  Start-Sleep -Seconds 3
}

& (Join-Path $pgBin 'pg_isready.exe') -h localhost -p 5432 -U ytbot | Write-Host

$env:PGHOST = 'localhost'
$env:PGPORT = '5432'
$env:PGUSER = 'ytbot'
$dbExists = & (Join-Path $pgBin 'psql.exe') -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'ytbot'"
if (($dbExists | Out-String).Trim() -ne '1') {
  & (Join-Path $pgBin 'createdb.exe') ytbot
}

$redisReady = Test-CommandSuccess { & $redisCli -p 6379 ping }
if (-not $redisReady) {
  $redisArguments = "--port 6379 --dir `"$RedisDataDir`" --appendonly yes"
  Start-Process -FilePath $redisServer `
    -ArgumentList $redisArguments `
    -WorkingDirectory $RedisDataDir `
    -RedirectStandardOutput (Join-Path $StorageDir 'redis.stdout.log') `
    -RedirectStandardError (Join-Path $StorageDir 'redis.stderr.log') `
    -WindowStyle Hidden
  Start-Sleep -Seconds 3
}

& $redisCli -p 6379 ping | Write-Host

Push-Location $ProjectRoot
try {
  Invoke-Native 'npm.cmd' @('run', 'db:generate')
  Invoke-Native 'npm.cmd' @('run', 'db:migrate')
  Invoke-Native 'npm.cmd' @('run', 'db:seed')

  if (-not $SkipApp) {
    Invoke-Native 'npm.cmd' @('run', 'dev')
  }
}
finally {
  Pop-Location
}

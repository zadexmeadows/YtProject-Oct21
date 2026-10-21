# Run this file from an Administrator PowerShell window.
# It enables the Windows features Docker Desktop needs for Linux containers.

$ErrorActionPreference = "Stop"

Write-Host "Enabling Windows Subsystem for Linux..." -ForegroundColor Cyan
dism.exe /online /Enable-Feature /FeatureName:Microsoft-Windows-Subsystem-Linux /All /NoRestart

Write-Host "Enabling Virtual Machine Platform..." -ForegroundColor Cyan
dism.exe /online /Enable-Feature /FeatureName:VirtualMachinePlatform /All /NoRestart

Write-Host "Setting WSL 2 as the default version..." -ForegroundColor Cyan
wsl.exe --set-default-version 2

Write-Host ""
Write-Host "Done. Please restart Windows, open Docker Desktop, then tell Codex: continue" -ForegroundColor Green

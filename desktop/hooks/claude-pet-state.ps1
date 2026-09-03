# Tell Claude Pet what Claude Code is doing (Windows).
#
# Writes a single word to %APPDATA%\claude-pet\state; the pet watches that file
# and reacts: "working" -> cooking mode, "done" -> celebration,
# "error" -> worried. Removing the file means idle.
#
# Usage:  powershell -File claude-pet-state.ps1 working|done|error|idle
param([string]$State = 'idle')

$dir = Join-Path $env:APPDATA 'claude-pet'
$file = Join-Path $dir 'state'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

switch ($State) {
    { $_ -in 'working', 'done', 'error' } {
        Set-Content -Path $file -Value $State -NoNewline
    }
    default {
        Remove-Item -Path $file -ErrorAction SilentlyContinue
    }
}


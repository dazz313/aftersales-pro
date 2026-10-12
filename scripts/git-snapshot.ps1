# Snapshot otomatis AfterSales Pro — dipanggil Task Scheduler tiap jam.
# Merekam SEMUA perubahan kode yang belum di-commit ke branch aktif.
# Aman: menghormati .gitignore (DB live, .env, .next, arsip tidak ikut),
# tidak push ke mana-mana, tidak mengubah file, diam bila working tree bersih.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

# Bukan repo git -> keluar diam-diam
git rev-parse --git-dir *> $null
if ($LASTEXITCODE -ne 0) { exit 0 }

git add -A *> $null
$staged = git diff --cached --name-only
if ([string]::IsNullOrWhiteSpace(($staged | Out-String))) { exit 0 }  # bersih
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
git commit -q -m "auto-snapshot $stamp" *> $null
exit 0

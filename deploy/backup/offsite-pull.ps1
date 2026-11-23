# D-1 (владелец 03.11): забор зашифрованной копии базы на соседнюю машину.
#
# Запускается Планировщиком Windows раз в сутки (задача jw-offsite-pull).
# Сервер отдаёт только шифротекст age через пользователя backup-pull
# (deploy/backup/offsite-serve.sh); ключа расшифровки здесь нет и быть не должно —
# он у владельца. Проверяется только целостность передачи (sha256).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\jw-backup\offsite-pull.ps1
$ErrorActionPreference = 'Stop'
$Dest = 'C:\jw-backup\copies'
$Key = 'C:\jw-backup\backup-pull_ed25519'
$Remote = 'backup-pull@justwriting.ru'
$Keep = 30
$MaxAgeHours = 48
$Log = 'C:\jw-backup\offsite-pull.log'

function Say($msg) { "$(Get-Date -Format o) $msg" | Add-Content -Path $Log; Write-Output $msg }
function Remote($cmd) {
  $out = & ssh -n -i $Key -o BatchMode=yes -o StrictHostKeyChecking=yes -o LogLevel=ERROR $Remote $cmd
  if ($LASTEXITCODE -ne 0) { throw "ssh '$cmd' — код $LASTEXITCODE" }
  return $out
}

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
try {
  $name = (Remote 'latest' | Select-Object -First 1).Trim()
  if ($name -notmatch '^justwriting-(\d{8})-(\d{6})\.dump\.age$') { throw "неожиданное имя копии: '$name'" }
  $stamp = [datetime]::ParseExact("$($Matches[1])$($Matches[2])", 'yyyyMMddHHmmss', $null)
  $target = Join-Path $Dest $name
  if (-not (Test-Path $target)) {
    $expected = ((Remote "sha $name") -split '\s+')[0].ToLower()
    $tmp = "$target.partial"
    # Байты — через cmd: PowerShell-конвейер перекодировал бы двоичный поток.
    & cmd /c "ssh -n -i `"$Key`" -o BatchMode=yes -o StrictHostKeyChecking=yes -o LogLevel=ERROR $Remote get $name > `"$tmp`""
    if ($LASTEXITCODE -ne 0) { Remove-Item -Force -ErrorAction SilentlyContinue $tmp; throw "get $name — код $LASTEXITCODE" }
    $actual = (Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLower()
    if ($actual -ne $expected) { Remove-Item -Force $tmp; throw "сумма не сошлась: $actual против $expected" }
    Move-Item -Force $tmp $target
    "$expected  $name" | Set-Content -Path "$target.sha256" -Encoding ascii
    Say "забрано: $name ($([math]::Round((Get-Item $target).Length / 1MB, 1)) МБ)"
  } else {
    Say "уже есть: $name"
  }
  # Ротация: 30 последних + копия за первое число месяца, полгода. Сервер мог
  # копить «похудевшие» копии (тревога SHRINK там стопорит только свою ротацию),
  # и короткий хвост здесь вытеснил бы последние хорошие.
  $all = Get-ChildItem $Dest -Filter 'justwriting-*.dump.age' | Sort-Object Name -Descending
  $monthly = $all | Where-Object { $_.Name -match '^justwriting-\d{6}01-' } | Select-Object -First 6
  $all | Select-Object -Skip $Keep | Where-Object { $monthly -notcontains $_ } |
    ForEach-Object { Remove-Item -Force $_.FullName, "$($_.FullName).sha256" -ErrorAction SilentlyContinue }
  $age = ((Get-Date).ToUniversalTime() - $stamp).TotalHours
  if ($age -gt $MaxAgeHours) { throw ("самая свежая копия на сервере старше {0:N0} ч — копирование на сервере остановилось" -f $age) }
  exit 0
} catch {
  Say "ОШИБКА: $($_.Exception.Message)"
  exit 1
}

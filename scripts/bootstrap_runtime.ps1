param(
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AppRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $AppRoot "python_runtime"
$PyExe = Join-Path $RuntimeDir "python.exe"
$PywExe = Join-Path $RuntimeDir "pythonw.exe"
$ReqFile = Join-Path $AppRoot "requirements.txt"
$HashStamp = Join-Path $RuntimeDir ".reqs_hash"

function Invoke-QuietPyCheck {
    param([string[]]$ArgsList)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $PyExe @ArgsList 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } finally {
        $ErrorActionPreference = $prev
    }
}

$ReqHash = (Get-FileHash -Path $ReqFile -Algorithm SHA256).Hash

$IsReady = $false
if ((Test-Path $PyExe) -and (Test-Path $PywExe) -and (Test-Path $HashStamp)) {
    $SavedHash = (Get-Content -Path $HashStamp -Raw).Trim()
    if ($SavedHash -eq $ReqHash) {
        if (Invoke-QuietPyCheck @("-c", "import aiohttp, PIL, webview, cv2")) {
            $IsReady = $true
        }
    }
}

if ($IsReady) {
    if (-not $CheckOnly) {
        Write-Host "[HammelArt Setup] Portable Python runtime is already up to date." -ForegroundColor Green
    }
    exit 0
}

if (-not (Test-Path $PyExe)) {
    Write-Host "[HammelArt Setup] Downloading standalone Python 3.11 runtime (~10 MB)..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    $ZipPath = Join-Path $env:TEMP "hm_python_311_embed.zip"
    $PyUrl = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip"
    Invoke-WebRequest -Uri $PyUrl -OutFile $ZipPath -UseBasicParsing
    Expand-Archive -Path $ZipPath -DestinationPath $RuntimeDir -Force
    Remove-Item $ZipPath -Force -ErrorAction SilentlyContinue
}

# Ensure embeddable Python enables site-packages & parent directory imports (even on retry)
$PthFile = Join-Path $RuntimeDir "python311._pth"
if (Test-Path $PthFile) {
    $lines = Get-Content -Path $PthFile | ForEach-Object {
        if ($_ -match '^\s*#\s*import site\s*$') { "import site" } else { $_ }
    }
    if ($lines -notcontains "..") {
        $lines += ".."
    }
    Set-Content -Path $PthFile -Value $lines -Encoding ASCII
}

if (-not (Invoke-QuietPyCheck @("-m", "pip", "--version"))) {
    Write-Host "[HammelArt Setup] Installing pip into portable runtime..." -ForegroundColor Cyan
    $GetPip = Join-Path $env:TEMP "hm_get_pip.py"
    Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $GetPip -UseBasicParsing
    & $PyExe $GetPip --no-warn-script-location
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to bootstrap pip in portable runtime."
    }
    Remove-Item $GetPip -Force -ErrorAction SilentlyContinue
}

Write-Host "[HammelArt Setup] Installing HammelArt Atelier dependencies (first-time setup)..." -ForegroundColor Cyan
& $PyExe -m pip install --upgrade --prefer-binary --no-warn-script-location -r $ReqFile
if ($LASTEXITCODE -ne 0) {
    throw "pip install failed."
}

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $PyExe -c "import aiohttp, PIL, webview, cv2"
$verifyExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
if ($verifyExit -ne 0) {
    throw "Runtime verification import failed after install."
}

Set-Content -Path $HashStamp -Value $ReqHash -Encoding ASCII
Write-Host "[HammelArt Setup] Ready! Portable runtime installed cleanly." -ForegroundColor Green
exit 0

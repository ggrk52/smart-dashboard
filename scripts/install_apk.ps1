param (
    [string]$AppPackage = "com.codex.magicmirrorcontroller",
    [string]$MainActivity = "com.codex.magicmirrorcontroller.MainActivity",
    [switch]$SkipBuild
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$AndroidDir = Join-Path $ScriptDir "..\android"
$ApkPath = Join-Path $ScriptDir "..\android\app\build\outputs\apk\debug\app-debug.apk"

$ErrorActionPreference = "Stop"

if (-not $SkipBuild) {
    Write-Host "========== BUILDING APK ==========" -ForegroundColor Cyan
    Push-Location $AndroidDir
    try {
        .\gradlew.bat assembleDebug
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Build failed with exit code $LASTEXITCODE" -ForegroundColor Red
            exit $LASTEXITCODE
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "========== SKIPPING BUILD ==========" -ForegroundColor Yellow
}

if (-not (Test-Path $ApkPath)) {
    Write-Host "APK file not found at $ApkPath" -ForegroundColor Red
    exit 1
}

Write-Host "========== INSTALLING APK ==========" -ForegroundColor Cyan
Write-Host "Make sure your Android device is connected via USB or Wi-Fi debugging." -ForegroundColor Yellow
$InstallOutput = adb install -r $ApkPath 2>&1
$InstallOutput | Out-Host

if ($LASTEXITCODE -ne 0) {
    if ($InstallOutput -match "INSTALL_FAILED_UPDATE_INCOMPATIBLE") {
        Write-Host ""
        Write-Host "⚠️ ВНИМАНИЕ: Ошибка подписи (INSTALL_FAILED_UPDATE_INCOMPATIBLE)." -ForegroundColor Yellow
        Write-Host "Это значит, что на устройстве уже стоит версия приложения, подписанная другим ключом." -ForegroundColor Yellow
        Write-Host "Сейчас я удалю старую версию (настройки сбросятся) и установлю новую!" -ForegroundColor Cyan
        
        adb uninstall $AppPackage | Out-Null
        $RetryOutput = adb install -r $ApkPath 2>&1
        $RetryOutput | Out-Host
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Повторная установка не удалась." -ForegroundColor Red
            exit $LASTEXITCODE
        }
    } else {
        Write-Host "Installation failed. Check if ADB is installed and device is connected." -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

Write-Host "========== LAUNCHING APP ==========" -ForegroundColor Cyan
adb shell am start -n "$AppPackage/$MainActivity"
if ($LASTEXITCODE -eq 0) {
    Write-Host "Success! App launched on device." -ForegroundColor Green
} else {
    Write-Host "Failed to launch app." -ForegroundColor Red
}

# PowerShell script to set up SSL with Caddy as a permanent background service for seereen.duckdns.org
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "==============================================" -ForegroundColor Green
Write-Host "   چالاککردنی بڕوانامەی فەرمی SSL / HTTPS" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green

# 1. Firewall rules
Write-Host "`n[1/3] کردنەوەی پۆرتەکانی 80 و 443 لە فایەروۆڵی ویندۆز..." -ForegroundColor Cyan
netsh advfirewall firewall add rule name="Seereen Port 80" dir=in action=allow protocol=TCP localport=80 | Out-Null
netsh advfirewall firewall add rule name="Seereen Port 443" dir=in action=allow protocol=TCP localport=443 | Out-Null
Write-Host " پۆرتەکان کرانەوە." -ForegroundColor Green

# 2. Download Caddy if needed
if (!(Test-Path "C:\caddy\caddy.exe")) {
    New-Item -ItemType Directory -Path "C:\caddy" -Force | Out-Null
    Write-Host "`n[2/3] داگرتنی پڕۆگرامی Caddy..." -ForegroundColor Cyan
    curl.exe -L "https://caddyserver.com/api/download?os=windows&arch=amd64" -o "C:\caddy\caddy.exe"
}
Write-Host " پڕۆگرامی Caddy ئامادەیە." -ForegroundColor Green

# 3. Setup auto-start scheduled task
Write-Host "`n[3/3] ڕێکخستنی خزمەتگوزاری هەمیشەیی لە پاشبنەما (Background Service)..." -ForegroundColor Cyan
$action = New-ScheduledTaskAction -Execute "C:\caddy\caddy.exe" -Argument "reverse-proxy --from seereen.duckdns.org --to localhost:4000"
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Unregister-ScheduledTask -TaskName "CaddySSL" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "CaddySSL" -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName "CaddySSL"

Write-Host "`n خزمەتگوزاری Caddy بەسەرکەوتوویی لە پاشبنەما دەستی پێکرد!" -ForegroundColor Green
Write-Host "تەنانەت ئەگەر پەنجەرەکەش دابخەیت، SSL بەردەوام کاردەکات." -ForegroundColor Yellow
Write-Host "لینکەکەت بە HTTPS ئامادەیە: https://seereen.duckdns.org" -ForegroundColor Cyan

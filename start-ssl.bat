@echo off
chcp 65001 >nul
title Seereen SSL / HTTPS Starter
echo ==============================================
echo  چالاککردنی بڕوانامەی فەرمی SSL / HTTPS
echo ==============================================
echo.

echo [1/3] کردنەوەی پۆرتەکانی فایەروۆڵ (80 و 443)...
netsh advfirewall firewall add rule name="Seereen Port 80" dir=in action=allow protocol=TCP localport=80 >nul 2>&1
netsh advfirewall firewall add rule name="Seereen Port 443" dir=in action=allow protocol=TCP localport=443 >nul 2>&1

if not exist "C:\caddy" mkdir "C:\caddy"
if not exist "C:\caddy\caddy.exe" (
    echo [2/3] داگرتنی پڕۆگرامی Caddy...
    curl.exe -L "https://caddyserver.com/api/download?os=windows&arch=amd64" -o "C:\caddy\caddy.exe"
)

echo [3/3] دەستپێکردنی سێرڤەری پارێزراوی HTTPS بۆ seereen.duckdns.org ...
echo پڕۆگرامەکە بڕوانامەی فەرمی بێبەرامبەر دەهێنێت و قوفڵە سەوزەکە چالاک دەکات.
echo.
"C:\caddy\caddy.exe" reverse-proxy --from seereen.duckdns.org --to localhost:4000
pause

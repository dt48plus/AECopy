# Author: Ilhan Turan - https://ilhanturan.fr
# AECopy v1.1.0 - compile AECopy.exe avec son icone (csc du .NET Framework 4, present sur tout Windows).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$refs = '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll'
# 1. exe sans icone, qui sait dessiner le logo ; 2. icone ; 3. exe final avec l'icone.
& $csc /nologo /target:winexe /optimize+ /out:AECopy_tmp.exe @refs AECopy.cs
if ($LASTEXITCODE) { throw "compilation" }
& .\AECopy_tmp.exe --make-icon AECopy.ico | Out-Null
Start-Sleep -Milliseconds 300
Remove-Item AECopy_tmp.exe
& $csc /nologo /target:winexe /optimize+ /win32icon:AECopy.ico /out:AECopy.exe @refs AECopy.cs
if ($LASTEXITCODE) { throw "compilation" }
Get-Item AECopy.exe, AECopy.ico | Select-Object Name, Length

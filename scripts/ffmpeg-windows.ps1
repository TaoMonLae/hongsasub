$ErrorActionPreference = "Stop"
$series = "9.0"
$zip = "ffmpeg-n$series-latest-win64-lgpl-$series.zip"
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "src-tauri/binaries"
$work = Join-Path ([IO.Path]::GetTempPath()) "hongsasub-ffmpeg"

Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $work, (Join-Path $out "ffmpeg-licence") | Out-Null
Invoke-WebRequest "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/$zip" -OutFile (Join-Path $work $zip)
Expand-Archive (Join-Path $work $zip) -DestinationPath $work
$dir = Get-ChildItem $work -Directory | Select-Object -First 1

foreach ($tool in "ffmpeg", "ffprobe") {
  Copy-Item (Join-Path $dir.FullName "bin/$tool.exe") (Join-Path $out "$tool-x86_64-pc-windows-msvc.exe")
}
Copy-Item (Join-Path $dir.FullName "LICENSE.txt") (Join-Path $out "ffmpeg-licence/LICENSE.txt")

$ffmpeg = Join-Path $out "ffmpeg-x86_64-pc-windows-msvc.exe"
$version = (& $ffmpeg -hide_banner -version | Select-Object -First 1)
$encoders = (& $ffmpeg -hide_banner -encoders) -join "`n"
if ($encoders -notmatch "h264_mf" -and $encoders -notmatch "libopenh264") { throw "This FFmpeg build has no H.264 encoder" }
if ($encoders -match "libx264") { throw "This FFmpeg build is GPL, expected LGPL" }

@"
HongsaSub includes FFmpeg (https://ffmpeg.org) for Windows, from the LGPL builds at
https://github.com/BtbN/FFmpeg-Builds ($zip).

$version

FFmpeg is licensed under the GNU Lesser General Public License, version 2.1 or later.
The licence text is in LICENSE.txt next to this file. FFmpeg is a separate program
that HongsaSub runs; it is not linked into HongsaSub.

Source code: https://github.com/FFmpeg/FFmpeg/tree/release/$series
Build scripts: https://github.com/BtbN/FFmpeg-Builds
"@ | Set-Content -Encoding utf8 (Join-Path $out "ffmpeg-licence/README.txt")

Write-Output $version

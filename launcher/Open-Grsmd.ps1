<#
.SYNOPSIS
Opens a file in GRSMD (GR Simple Markdown), the copy of GRSMD that you keep on this PC.

.DESCRIPTION
Open-Grsmd.ps1 writes a temporary copy of GRSMD.html that carries the file,
opens the copy in a browser, and deletes the copy after a short wait.
GRSMD opens the file as if you had dropped it on the page: a .md file is
rendered, another text file is shown in the code view, and a binary file is
refused.

Nothing is sent over the network. The file goes into the temporary copy
only, in the folder "temp" next to this script. GRSMD reads it from the
page and removes it from the page.

GRSMD.html is a GRSMD build (the index.html of a release, saved under the
name GRSMD.html). Put it next to this script, or pass -GrsmdPath. An older
build without the launch slot is refused.

Saving: GRSMD has no handle to the file, so Ctrl+S asks where to save
(Chrome and Edge) or downloads (Firefox). The script puts the full path of
the file on the clipboard: choose Save as, paste the path as the file name
and confirm the overwrite.

.PARAMETER Path
The file to open. A relative path is taken from the current directory.
Wildcards are not expanded. At most 5 MB (5,242,880 bytes).

.PARAMETER GrsmdPath
The GRSMD build to copy. Default: GRSMD.html in the folder of this script.

.PARAMETER Browser
Default (the program that opens .html files), Edge, Chrome or Firefox.

.PARAMETER KeepSeconds
How long to wait before the temporary copy is deleted (0 to 3600, default
30). Copies older than this, left by a run whose window was closed, are
deleted when the script starts.

.PARAMETER NoStart
Write the temporary copy and print its path, but do not start a browser and
do not touch the clipboard. The copy is still deleted after -KeepSeconds.

.EXAMPLE
.\Open-Grsmd.ps1 .\notes\plan.md

Opens plan.md in the browser that opens .html files.

.EXAMPLE
.\Open-Grsmd.ps1 C:\work\README.md -Browser Chrome -KeepSeconds 60

Opens README.md in Chrome and deletes the temporary copy after 60 seconds.

.EXAMPLE
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Tools\grsmd\Open-Grsmd.ps1"

A desktop shortcut: create a shortcut whose target is the line above (with
the folder of this script). Drop a file on the shortcut's icon to open it in
GRSMD: Windows adds the file's path to the line.

.NOTES
A script downloaded from the internet may be blocked by the execution
policy. Either run "Unblock-File .\Open-Grsmd.ps1" once, or start it with
"powershell.exe -ExecutionPolicy Bypass -File .\Open-Grsmd.ps1 <file>"
(this applies to that one run only). The script itself changes no setting.

Exit code: 0 when done, 1 on any error (the error is one line that starts
with "Open-Grsmd:").

Specification: spec/grsmd_launcher_spec_en.md
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path,

    [string]$GrsmdPath,

    [ValidateSet('Default', 'Edge', 'Chrome', 'Firefox')]
    [string]$Browser = 'Default',

    [ValidateRange(0, 3600)]
    [int]$KeepSeconds = 30,

    [switch]$NoStart
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

# The contract with the GRSMD build (spec 4.4, main spec INV-104).
$LaunchSlot = '<!--grsmd-launch-slot-->'
$LaunchBlockId = 'grsmd-launch-file'
$CopyPrefix = 'grsmd-launch-'
# GRSMD's own limit (main spec CON-08, CONFIG.fileDrop.maxBytes).
$MaxBytes = 5242880
$BrowserExe = @{ Edge = 'msedge.exe'; Chrome = 'chrome.exe'; Firefox = 'firefox.exe' }

<#
.SYNOPSIS
Ends the run with one error line and exit code 1 (spec 4.3).
@purity non-pure
#>
function Stop-Launch([string]$Message) {
    [Console]::Error.WriteLine("Open-Grsmd: $Message")
    exit 1
}

<#
.SYNOPSIS
The byte offset of the launch slot inside <head>, or -1.
@purity pure
#>
function Find-LaunchSlot([byte[]]$Html) {
    # ISO-8859-1 maps each byte to one char, so a char index is a byte index.
    $text = [System.Text.Encoding]::GetEncoding(28591).GetString($Html)
    $slot = $text.IndexOf($LaunchSlot, [System.StringComparison]::Ordinal)
    $headEnd = $text.IndexOf('</head>', [System.StringComparison]::OrdinalIgnoreCase)
    if ($slot -lt 0 -or $headEnd -lt 0 -or $slot -gt $headEnd) { return -1 }
    return $slot
}

<#
.SYNOPSIS
The launch block for a file: its leaf name and bytes, both in Base64 (spec 4.4).
@purity pure
#>
function New-LaunchBlock([string]$Name, [byte[]]$Bytes) {
    $nameBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Name))
    $bytesBase64 = [Convert]::ToBase64String($Bytes)
    return "<script type=`"text/plain`" id=`"$LaunchBlockId`" data-name=`"$nameBase64`">$bytesBase64</script>"
}

<#
.SYNOPSIS
The full path of a browser registered under App Paths, or $null.
@purity semi-pure-b
#>
function Get-BrowserPath([string]$ExeName) {
    foreach ($root in 'HKCU:', 'HKLM:') {
        $key = "$root\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$ExeName"
        if (-not (Test-Path -LiteralPath $key)) { continue }
        $value = (Get-Item -LiteralPath $key).GetValue('')
        if ($value) {
            $exe = ([string]$value).Trim('"')
            if (Test-Path -LiteralPath $exe -PathType Leaf) { return $exe }
        }
    }
    return $null
}

<#
.SYNOPSIS
Deletes the copies in the temp folder older than KeepSeconds (spec FR-L08).
@purity non-pure
#>
function Remove-OldCopies([string]$Folder, [int]$AgeSeconds) {
    if (-not (Test-Path -LiteralPath $Folder -PathType Container)) { return }
    $limit = [DateTime]::UtcNow.AddSeconds(-$AgeSeconds)
    foreach ($old in Get-ChildItem -LiteralPath $Folder -Filter "$CopyPrefix*.html" -File) {
        if ($old.LastWriteTimeUtc -ge $limit) { continue }
        try {
            Remove-Item -LiteralPath $old.FullName -Force
        } catch {
            Write-Warning "Could not delete an old temporary copy: $($old.FullName)"
        }
    }
}

<#
.SYNOPSIS
Writes the build with the launch slot replaced by the block (spec FR-L07).
@purity non-pure
#>
function Write-LaunchCopy([string]$CopyPath, [byte[]]$Html, [int]$SlotAt, [string]$Block) {
    $blockBytes = [System.Text.Encoding]::ASCII.GetBytes($Block)
    $after = $SlotAt + $LaunchSlot.Length
    $stream = [System.IO.File]::Open($CopyPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
    try {
        $stream.Write($Html, 0, $SlotAt)
        $stream.Write($blockBytes, 0, $blockBytes.Length)
        $stream.Write($Html, $after, $Html.Length - $after)
    } finally {
        $stream.Dispose()
    }
}

# --- Checking: every input is read before anything is written (spec 3.4).

$targetPath = $PSCmdlet.GetUnresolvedProviderPathFromPSPath($Path)
if (Test-Path -LiteralPath $targetPath -PathType Container) { Stop-Launch "Not a file: $targetPath" }
if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) { Stop-Launch "File not found: $targetPath" }
$targetSize = (Get-Item -LiteralPath $targetPath).Length
if ($targetSize -gt $MaxBytes) { Stop-Launch "The file is larger than 5 MB ($targetSize bytes): $targetPath" }
try {
    $targetBytes = [System.IO.File]::ReadAllBytes($targetPath)
} catch {
    Stop-Launch "Cannot read ${targetPath}: $($_.Exception.Message)"
}

if ($GrsmdPath) {
    $grsmdFile = $PSCmdlet.GetUnresolvedProviderPathFromPSPath($GrsmdPath)
} else {
    $grsmdFile = Join-Path $PSScriptRoot 'GRSMD.html'
}
if (-not (Test-Path -LiteralPath $grsmdFile -PathType Leaf)) {
    Stop-Launch "GRSMD.html not found: $grsmdFile. Put GRSMD.html next to this script or pass -GrsmdPath."
}
try {
    $grsmdBytes = [System.IO.File]::ReadAllBytes($grsmdFile)
} catch {
    Stop-Launch "Cannot read ${grsmdFile}: $($_.Exception.Message)"
}
$slotAt = Find-LaunchSlot $grsmdBytes
if ($slotAt -lt 0) { Stop-Launch "$grsmdFile has no launch slot. Use a newer GRSMD.html." }

$browserExePath = $null
if (-not $NoStart -and $Browser -ne 'Default') {
    $browserExePath = Get-BrowserPath $BrowserExe[$Browser]
    if (-not $browserExePath) { Stop-Launch "$Browser was not found." }
}

# --- Writing, starting and waiting. The copy is deleted in "finally": after
# the wait, on an error, and on Ctrl+C. Only a closed window leaves it, for
# the next run's sweep.

$tempFolder = Join-Path $PSScriptRoot 'temp'
$copyPath = $null
$candidate = $null
try {
    try {
        Remove-OldCopies $tempFolder $KeepSeconds
        if (-not (Test-Path -LiteralPath $tempFolder -PathType Container)) {
            New-Item -ItemType Directory -Path $tempFolder | Out-Null
        }
        $candidate = Join-Path $tempFolder ($CopyPrefix + [Guid]::NewGuid().ToString('N') + '.html')
        $block = New-LaunchBlock ([System.IO.Path]::GetFileName($targetPath)) $targetBytes
        Write-LaunchCopy $candidate $grsmdBytes $slotAt $block
        $copyPath = $candidate
    } catch {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { $copyPath = $candidate }
        Stop-Launch "Cannot write the temporary copy in ${tempFolder}: $($_.Exception.Message)"
    }

    if ($NoStart) {
        Write-Output "Temporary copy: $copyPath"
    } else {
        try {
            if ($browserExePath) {
                Start-Process -FilePath $browserExePath -ArgumentList ('"' + ([Uri]$copyPath).AbsoluteUri + '"')
            } else {
                Start-Process -FilePath $copyPath
            }
        } catch {
            Stop-Launch "Cannot start the browser: $($_.Exception.Message)"
        }
        Write-Output "Opened in GRSMD: $targetPath"
        try {
            Set-Clipboard -Value $targetPath
            Write-Output 'The full path of the file is on the clipboard. To save over the file, choose Save as and paste it as the file name.'
        } catch {
            Write-Warning "Could not put the path on the clipboard: $($_.Exception.Message)"
        }
    }

    Write-Output "The temporary copy is deleted in $KeepSeconds s (Ctrl+C deletes it now)."
    Start-Sleep -Seconds $KeepSeconds
} finally {
    if ($copyPath -and (Test-Path -LiteralPath $copyPath)) {
        try {
            Remove-Item -LiteralPath $copyPath -Force
        } catch {
            Write-Warning "Could not delete the temporary copy: $copyPath"
        }
    }
}

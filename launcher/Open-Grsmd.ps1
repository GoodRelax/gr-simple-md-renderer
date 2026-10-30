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
only, in the folder "grsmd-launcher" of your temporary folder
(%TEMP%\grsmd-launcher), outside folders that a cloud service such as
OneDrive syncs. GRSMD reads it from the page and removes it from the page.
So that you can find that folder, the script keeps its full path in
grsmd-launcher-personal-help.md next to this script (nothing of the files
you open goes there).

GRSMD.html is a GRSMD build (the index.html of a release, saved under the
name GRSMD.html). Put it next to this script, or pass -GrsmdPath. An older
build without the launch slot is refused.

Saving: GRSMD has no handle to the file, so the first save asks where to
save (Chrome and Edge) or downloads (Firefox). Press [Save] in GRSMD: it
puts the full path of the file on the clipboard and opens the save dialog.
Paste the path as the file name with Ctrl+V and confirm the overwrite.
Later saves write to the same file. The script itself does not touch the
clipboard.

.PARAMETER Path
The file to open. A relative path is taken from the current directory.
Wildcards are not expanded. At most 5 MB (5,242,880 bytes).

.PARAMETER GrsmdPath
The GRSMD build to copy. Default: GRSMD.html in the folder of this script.

.PARAMETER Browser
Default (the program that opens .html files), Edge, Chrome or Firefox.

.PARAMETER KeepSeconds
How long to wait before the temporary copy is deleted (default 30). When a
browser is started: 5 to 3600, so that the browser can read the copy first.
With -NoStart: 0 to 3600. The copy's name carries the time at which it may
be deleted; a copy left by a run whose window was closed is deleted by the
next run once that time has passed.

.PARAMETER NoStart
Write the temporary copy and print its path, but do not start a browser.
The copy is still deleted after -KeepSeconds.
-Browser is not checked.

.EXAMPLE
.\Open-Grsmd.ps1 .\notes\plan.md

Opens plan.md in the browser that opens .html files.

.EXAMPLE
.\Open-Grsmd.ps1 C:\work\README.md -Browser Chrome -KeepSeconds 60

Opens README.md in Chrome and deletes the temporary copy after 60 seconds.
If you close the window before that, the copy stays in
%TEMP%\grsmd-launcher until a later run deletes it.

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

Exit code: 0 when done, 1 on any error. The error is one line on the
standard error of the process, starting with "Open-Grsmd:"; a reason given
by Windows is in the language of Windows.

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
# A copy's name: the prefix, the UTC time at which it may be deleted, a
# random part (spec FR-L07, FR-L08).
$CopyTimeFormat = 'yyyyMMdd\THHmmss\Z'
$CopyNamePattern = '^' + [regex]::Escape($CopyPrefix) + '(\d{8}T\d{6}Z)-[0-9a-f]{32}\.html$'
# The browser reads the copy after Start-Process returns (spec FR-L11).
$MinBrowserKeepSeconds = 5
# GRSMD's own limit (main spec CON-08, CONFIG.fileDrop.maxBytes).
$MaxBytes = 5242880
$BrowserExe = @{ Edge = 'msedge.exe'; Chrome = 'chrome.exe'; Firefox = 'firefox.exe' }
# The note next to this script that keeps the temp folder's full path, so the
# user can find it (owner rulings PL-16 to PL-18; spec FR-L27, 4.4).
$PersonalHelpName = 'grsmd-launcher-personal-help.md'

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
The launch block for a file: its leaf name, its full path (for GRSMD's
[Save], main spec INV-105) and its bytes, all in Base64 (spec 4.4).
@purity pure
#>
function New-LaunchBlock([string]$Name, [string]$FullPath, [byte[]]$Bytes) {
    $nameBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Name))
    $pathBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($FullPath))
    $bytesBase64 = [Convert]::ToBase64String($Bytes)
    return "<script type=`"text/plain`" id=`"$LaunchBlockId`" data-name=`"$nameBase64`" data-path=`"$pathBase64`">$bytesBase64</script>"
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
The file name of a copy that may be deleted at DeleteAt (UTC) (spec FR-L07).
@purity pure
#>
function New-CopyName([DateTime]$DeleteAt, [string]$RandomHex) {
    $stamp = $DeleteAt.ToString($CopyTimeFormat, [System.Globalization.CultureInfo]::InvariantCulture)
    return "$CopyPrefix$stamp-$RandomHex.html"
}

<#
.SYNOPSIS
The UTC time at which a copy may be deleted, read from its name; $null for
a name that is not a copy's (spec FR-L08).
@purity pure
#>
function Get-CopyDeleteTime([string]$Name) {
    $match = [regex]::Match($Name, $CopyNamePattern)
    if (-not $match.Success) { return $null }
    $styles = [System.Globalization.DateTimeStyles]::AssumeUniversal -bor [System.Globalization.DateTimeStyles]::AdjustToUniversal
    $time = [DateTime]::MinValue
    if (-not [DateTime]::TryParseExact($match.Groups[1].Value, $CopyTimeFormat, [System.Globalization.CultureInfo]::InvariantCulture, $styles, [ref]$time)) {
        return $null
    }
    return $time
}

<#
.SYNOPSIS
Deletes the copies in the temp folder whose delete time has passed (spec
FR-L08). The time is in each name, so a run with a short wait never deletes
the copy of another run that still waits.
@purity non-pure
#>
function Remove-OldCopies([string]$Folder) {
    if (-not (Test-Path -LiteralPath $Folder -PathType Container)) { return }
    $now = [DateTime]::UtcNow
    foreach ($old in Get-ChildItem -LiteralPath $Folder -Filter "$CopyPrefix*.html" -File) {
        $deleteAt = Get-CopyDeleteTime $old.Name
        if ($null -eq $deleteAt -or $deleteAt -gt $now) { continue }
        try {
            Remove-Item -LiteralPath $old.FullName -Force
            Write-Output "Deleted an old temporary copy: $($old.FullName)"
        } catch {
            Write-Warning "Could not delete an old temporary copy: $($old.FullName)"
        }
    }
}

<#
.SYNOPSIS
The text of the personal help: the temp folder's full path, how to open it,
where the usage is. Nothing of the opened file (spec 4.4, PL-18).
@purity pure
#>
function New-PersonalHelp([string]$TempFolder) {
    return @(
        "Temporary folder of Open-Grsmd.ps1: ``$TempFolder``",
        '',
        'To open it, paste the path into the address bar of File Explorer.',
        '',
        'How to use the launcher: `Get-Help .\Open-Grsmd.ps1 -Full`',
        ''
    ) -join "`n"
}

<#
.SYNOPSIS
Writes the personal help next to this script, unless it already holds the
same text; warns and goes on when it cannot (spec FR-L27 to FR-L29).
@purity non-pure
#>
function Write-PersonalHelp([string]$HelpPath, [string]$Text) {
    try {
        $bytes = (New-Object System.Text.UTF8Encoding $false).GetBytes($Text)
        if (Test-Path -LiteralPath $HelpPath -PathType Leaf) {
            $old = [System.IO.File]::ReadAllBytes($HelpPath)
            if ([Convert]::ToBase64String($old) -eq [Convert]::ToBase64String($bytes)) { return }
        }
        [System.IO.File]::WriteAllBytes($HelpPath, $bytes)
    } catch {
        Write-Warning "Could not write ${HelpPath}: $($_.Exception.Message)"
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

if (-not $NoStart -and $KeepSeconds -lt $MinBrowserKeepSeconds) {
    Stop-Launch "-KeepSeconds must be $MinBrowserKeepSeconds or more when a browser is started (0 to $($MinBrowserKeepSeconds - 1) only with -NoStart)."
}

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

# The user's temporary folder, not the script's: a script kept under a synced
# folder (OneDrive) would send the copy to the cloud (owner ruling PL-14).
$tempFolder = Join-Path ([System.IO.Path]::GetTempPath()) 'grsmd-launcher'
Write-PersonalHelp (Join-Path $PSScriptRoot $PersonalHelpName) (New-PersonalHelp $tempFolder)

$copyPath = $null
$candidate = $null
try {
    try {
        Remove-OldCopies $tempFolder
        if (-not (Test-Path -LiteralPath $tempFolder -PathType Container)) {
            New-Item -ItemType Directory -Path $tempFolder | Out-Null
        }
        $deleteAt = [DateTime]::UtcNow.AddSeconds($KeepSeconds)
        $candidate = Join-Path $tempFolder (New-CopyName $deleteAt ([Guid]::NewGuid().ToString('N')))
        $block = New-LaunchBlock ([System.IO.Path]::GetFileName($targetPath)) $targetPath $targetBytes
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
        # The clipboard is left alone (owner ruling PL-22): GRSMD's [Save]
        # puts the path there when it is pressed (main spec INV-105).
        Write-Output 'To save over the file, press [Save] in GRSMD and paste the path with Ctrl+V as the file name.'
    }

    Write-Output "The temporary copy is deleted in $KeepSeconds s (Ctrl+C deletes it now)."
    Start-Sleep -Seconds $KeepSeconds
} finally {
    if ($copyPath -and (Test-Path -LiteralPath $copyPath)) {
        try {
            Remove-Item -LiteralPath $copyPath -Force
            # Straight to the console: after Ctrl+C the pipeline is stopped
            # and Write-Output would not show (owner request 2026-10-30).
            [Console]::Out.WriteLine("Deleted the temporary copy: $copyPath")
        } catch {
            Write-Warning "Could not delete the temporary copy: $copyPath"
        }
    }
}

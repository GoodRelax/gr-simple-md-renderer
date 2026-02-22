@echo off
REM ============================================================================
REM md2pdf.bat
REM ----------------------------------------------------------------------------
REM Drag & Drop Markdown (.md) -> PDF converter using Pandoc + XeLaTeX + Mermaid
REM
REM PURPOSE
REM   Convert Markdown files to well‑formatted Japanese PDF with diagrams.
REM   Designed for Windows + Pandoc + MiKTeX + Mermaid environment.
REM
REM USAGE
REM   1. Drag and drop a .md file onto this .bat
REM   OR
REM   2. Run: md2pdf.bat file.md
REM
REM OUTPUT
REM   PDF is created next to the input Markdown file.
REM
REM REQUIREMENTS (install once)
REM   1. Pandoc
REM      winget install --id JohnMacFarlane.Pandoc -e
REM
REM   2. MiKTeX (LaTeX engine providing xelatex)
REM      https://miktex.org/download
REM      After install: run MiKTeX Console -> Updates -> Update all
REM
REM   3. Mermaid CLI filter (for ```mermaid``` diagrams)
REM      npm install -g mermaid-filter
REM
REM   4. Fonts (Windows default OK)
REM      Yu Mincho / Yu Gothic / Consolas
REM
REM IMPORTANT WINDOWS NOTE
REM   Pandoc sometimes cannot resolve npm .cmd shims via PATH when called
REM   from batch files. Therefore we use an explicit full path to
REM   mermaid-filter.cmd below. Adjust if username differs.
REM
REM   Check location with:
REM     where mermaid-filter
REM
REM   Typical path:
REM     C:\Users\<USER>\AppData\Roaming\npm\mermaid-filter.cmd
REM
REM LAYOUT SETTINGS
REM   FONT        : main Japanese serif font
REM   SANSFONT    : sans font
REM   MONOFONT    : code font
REM   FONTSIZE    : base size
REM   LINESTRETCH : line spacing
REM   MARGIN      : page margin
REM
REM TROUBLESHOOT
REM   "pdflatex not found"
REM        -> install MiKTeX
REM
REM   "Could not find executable mermaid-filter"
REM        -> fix MERMAID_FILTER path below
REM
REM   garbled Japanese
REM        -> ensure xelatex engine + Japanese fonts
REM
REM   diagrams missing
REM        -> npm install -g mermaid-filter
REM
REM ============================================================================

setlocal

REM ==== Mermaid filter explicit path (EDIT IF USERNAME DIFFERS) ====
set "MERMAID_FILTER_FORMAT=pdf"
set "MERMAID_FILTER=C:\Users\good_\AppData\Roaming\npm\mermaid-filter.cmd"

REM ==== Input validation ====
if "%~1"=="" (
  echo No input file.
  echo Drag and drop a .md file onto this script.
  pause
  exit /b
)

set "INPUT=%~1"
set "DIR=%~dp1"
set "NAME=%~n1"
set "OUTPUT=%DIR%%NAME%.pdf"

REM ==== Layout configuration ====
set "FONT=Yu Mincho"
set "SANSFONT=Yu Gothic"
set "MONOFONT=Consolas"
set "FONTSIZE=12pt"
set "LINESTRETCH=1.6"
set "MARGIN=25mm"

echo.
echo Input : %INPUT%
echo Output: %OUTPUT%
echo.

REM ==== Pandoc conversion ====
pandoc "%INPUT%" ^
  -o "%OUTPUT%" ^
  --pdf-engine=xelatex ^
  --filter "%MERMAID_FILTER%" ^
  -V graphics=true ^
  -V mainfont="%FONT%" ^
  -V sansfont="%SANSFONT%" ^
  -V monofont="%MONOFONT%" ^
  -V fontsize=%FONTSIZE% ^
  -V linestretch=%LINESTRETCH% ^
  -V geometry:margin=%MARGIN% ^
  -V CJKmainfont="%FONT%"
  

if errorlevel 1 (
  echo.
  echo Conversion failed.
  echo Check Pandoc / MiKTeX / Mermaid filter path.
  pause
  exit /b 1
)

echo.
echo Conversion successful.
pause

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Workbook,

    [Parameter(Mandatory = $true)]
    [string]$Catalog,

    [switch]$ExpectCurrentBaseline
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$builder = Join-Path $PSScriptRoot 'build_club_stats.py'
$validator = Join-Path $PSScriptRoot 'validate_club_stats.py'
$output = [IO.Path]::GetFullPath((Join-Path $projectRoot 'output/web/data/club_stats_2026_2.js'))
$outputDirectory = [IO.Path]::GetDirectoryName($output)
$runToken = [Guid]::NewGuid().ToString('N')
$candidate = Join-Path $outputDirectory "club_stats_2026_2.js.next.$runToken"
$candidateTemp = "$candidate.tmp"
$replacementBackup = Join-Path $outputDirectory "club_stats_2026_2.js.backup.$runToken"
$workbookPath = (Resolve-Path -LiteralPath $Workbook).Path
$catalogPath = (Resolve-Path -LiteralPath $Catalog).Path

if ([IO.Path]::GetPathRoot($candidate) -ne [IO.Path]::GetPathRoot($output)) {
    throw "Candidate and public snapshot must be on the same volume."
}

$beforeWorkbook = (Get-FileHash -Algorithm SHA256 -LiteralPath $workbookPath).Hash
$beforeCatalog = (Get-FileHash -Algorithm SHA256 -LiteralPath $catalogPath).Hash

try {
    & python $builder `
        --workbook $workbookPath `
        --catalog $catalogPath `
        --output $candidate `
        --phase 'round2-recruitment-guide'
    if ($LASTEXITCODE -ne 0) {
        throw "Club stats generation failed."
    }

    $validateArgs = @(
        $validator,
        $candidate,
        '--workbook', $workbookPath,
        '--catalog', $catalogPath
    )
    if ($ExpectCurrentBaseline) {
        $validateArgs += '--expect-current-baseline'
    }
    & python @validateArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Club stats validation failed."
    }

    $afterWorkbook = (Get-FileHash -Algorithm SHA256 -LiteralPath $workbookPath).Hash
    $afterCatalog = (Get-FileHash -Algorithm SHA256 -LiteralPath $catalogPath).Hash
    if ($beforeWorkbook -ne $afterWorkbook -or $beforeCatalog -ne $afterCatalog) {
        throw "A source workbook changed during generation. Run the sync again."
    }

    if (Test-Path -LiteralPath $output) {
        [IO.File]::Replace($candidate, $output, $replacementBackup, $true)
    }
    else {
        [IO.File]::Move($candidate, $output)
    }
    Write-Host "Club stats snapshot updated: output/web/data/club_stats_2026_2.js"
}
finally {
    foreach ($ownedTemporaryPath in @($candidate, $candidateTemp, $replacementBackup)) {
        if (Test-Path -LiteralPath $ownedTemporaryPath) {
            Remove-Item -LiteralPath $ownedTemporaryPath -Force
        }
    }
}

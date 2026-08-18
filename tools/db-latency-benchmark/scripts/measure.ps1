<#
.SYNOPSIS
  Read-only latency sampler for the temporary Singapore DB-latency benchmark.
  Never modifies Render or the benchmark service -- issues only GET requests
  against the already-deployed benchmark's /parallel and /sequential
  endpoints (which themselves only ever run SELECT 1).

.PARAMETER BaseUrl
  Base URL of the deployed benchmark service, e.g.
  https://pure-home-db-latency-benchmark.onrender.com

.PARAMETER Samples
  Number of samples to take per endpoint. Defaults to 10.

.PARAMETER MinPauseSeconds / MaxPauseSeconds
  Random pause range between samples, to avoid hammering production.
  Defaults to 3-5 seconds.

.EXAMPLE
  ./measure.ps1 -BaseUrl "https://pure-home-db-latency-benchmark.onrender.com"
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl,

    [int]$Samples = 10,

    [int]$MinPauseSeconds = 3,
    [int]$MaxPauseSeconds = 5
)

$BaseUrl = $BaseUrl.TrimEnd('/')

function Invoke-BenchmarkSample {
    param([string]$Path)
    $uri = "$BaseUrl$Path"
    try {
        return Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 30
    } catch {
        Write-Warning "Request to $uri failed: $_"
        return $null
    }
}

function Wait-RandomPause {
    Start-Sleep -Seconds (Get-Random -Minimum $MinPauseSeconds -Maximum ($MaxPauseSeconds + 1))
}

function Measure-Endpoint {
    param([string]$Label, [string]$Path)

    Write-Output $Label
    for ($i = 1; $i -le $Samples; $i++) {
        $result = Invoke-BenchmarkSample -Path $Path
        if ($result) {
            $queries = ($result.queriesMs -join ',')
            Write-Output ("{0}: totalMs={1} queriesMs=[{2}]" -f $i, $result.totalMs, $queries)
        } else {
            Write-Output ("{0}: totalMs=FAILED" -f $i)
        }
        if ($i -lt $Samples) {
            Wait-RandomPause
        }
    }
    Write-Output ""
}

Measure-Endpoint -Label "PARALLEL" -Path "/parallel"
Measure-Endpoint -Label "SEQUENTIAL" -Path "/sequential"

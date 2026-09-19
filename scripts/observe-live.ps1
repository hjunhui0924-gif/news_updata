param(
  [double]$DurationHours = 2,
  [int]$IntervalSeconds = 300,
  [string]$BaseUrl = 'http://127.0.0.1:3000',
  [string]$DatabaseContainer = 'news_updata-db-1',
  [string]$DatabaseName = 'news',
  [string]$DatabaseUser = 'news',
  [string]$LogPath = ''
)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$workDirectory = Join-Path $workspace 'work'
if (-not $LogPath) { $LogPath = Join-Path $workDirectory 'live-observation.jsonl' }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null

function Invoke-Psql([string]$query) {
  $output = & docker exec $DatabaseContainer psql -U $DatabaseUser -d $DatabaseName -At -F '|' -c $query 2>&1
  if ($LASTEXITCODE -ne 0) { throw (($output -join ' ').Trim()) }
  return ($output -join "`n").Trim()
}

function Read-HeartbeatAge([string]$raw) {
  if (-not $raw) { return $null }
  try {
    $heartbeatText = $raw.Trim() -replace '^"|"$', ''
    $heartbeat = [DateTimeOffset]::Parse(
      $heartbeatText,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
    )
    return [int][Math]::Max(0, ([DateTimeOffset]::UtcNow - $heartbeat).TotalSeconds)
  } catch { return $null }
}

function Read-JobCounts([string]$raw) {
  $counts = @{}
  foreach ($line in ($raw -split "`n")) {
    if (-not $line) { continue }
    $parts = $line -split '\|', 3
    if ($parts.Count -eq 3) { $counts["$($parts[0])/$($parts[1])"] = [int]$parts[2] }
  }
  return $counts
}

$startedAt = [DateTimeOffset]::UtcNow
$deadline = $startedAt.AddHours($DurationHours)
$baselineFailed = $null
$previousAlerts = ''

while ([DateTimeOffset]::UtcNow -lt $deadline) {
  $now = [DateTimeOffset]::UtcNow
  $alerts = [System.Collections.Generic.List[string]]::new()
  $health = 'error'
  $database = 'unknown'
  $heartbeatAge = $null
  $workerProcesses = 0
  $jobCounts = @{}
  $failedJobs = $null
  $subscriptionIssues = $null
  $runningAge = $null
  $errorDetail = $null

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/api/health/live" -TimeoutSec 5
    $health = [string]$response.StatusCode
  } catch { $errorDetail = "health: $($_.Exception.Message)" }

  try {
    $databaseStatus = (& docker ps --filter "name=$DatabaseContainer" --format '{{.Status}}' 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -eq 0 -and $databaseStatus) { $database = $databaseStatus }
    else { $errorDetail = (($errorDetail, 'database container not running') | Where-Object { $_ }) -join '; ' }
    $heartbeatAge = Read-HeartbeatAge (Invoke-Psql "SELECT value FROM system_state WHERE key='worker-heartbeat';")
    $jobCounts = Read-JobCounts (Invoke-Psql "SELECT kind || '|' || status || '|' || count(*) FROM jobs GROUP BY kind,status ORDER BY kind,status;")
    $failedJobs = [int](Invoke-Psql "SELECT count(*) FROM jobs WHERE status='failed';")
    $subscriptionIssues = [int](Invoke-Psql "SELECT count(*) FROM subscriptions WHERE coalesce(data->>'error','') <> '' OR (data ? 'retryAt' AND (data->>'retryAt')::timestamptz > now());")
    $runningAge = [int](Invoke-Psql "SELECT coalesce(extract(epoch from (now()-min(updated_at))),0)::int FROM jobs WHERE status='running';")
  } catch { $errorDetail = (($errorDetail, "database query: $($_.Exception.Message)") | Where-Object { $_ }) -join '; ' }

  try {
    $workerProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'tsx watch --env-file=.env.local src/worker/main.ts' }).Count
  } catch { $errorDetail = (($errorDetail, "worker process: $($_.Exception.Message)") | Where-Object { $_ }) -join '; ' }

  if ($health -ne '200') { $alerts.Add('web_health_failed') }
  if ($database -notmatch 'healthy') { $alerts.Add('database_not_healthy') }
  if ($workerProcesses -lt 1 -or $null -eq $heartbeatAge -or $heartbeatAge -gt 90) { $alerts.Add('worker_heartbeat_stale') }
  if ($null -ne $runningAge -and $runningAge -gt 900) { $alerts.Add('job_running_too_long') }
  if ($null -ne $subscriptionIssues -and $subscriptionIssues -gt 0) { $alerts.Add('subscription_error_or_rate_limit') }
  if ($null -ne $failedJobs -and $null -ne $baselineFailed -and $failedJobs -gt $baselineFailed) { $alerts.Add('new_failed_jobs') }
  if ($null -eq $baselineFailed -and $null -ne $failedJobs) { $baselineFailed = $failedJobs }

  $snapshot = [ordered]@{
    timestamp = $now.ToString('o')
    health = $health
    database = $database
    workerProcesses = $workerProcesses
    heartbeatAgeSeconds = $heartbeatAge
    jobCounts = $jobCounts
    failedJobs = $failedJobs
    baselineFailedJobs = $baselineFailed
    subscriptionIssues = $subscriptionIssues
    oldestRunningJobAgeSeconds = $runningAge
    alerts = @($alerts)
    error = $errorDetail
  }
  ($snapshot | ConvertTo-Json -Compress -Depth 6) | Add-Content -LiteralPath $LogPath -Encoding utf8

  $alertKey = (@($alerts) -join ',')
  if ($alertKey -ne $previousAlerts) {
    $alertLine = [ordered]@{ timestamp = $now.ToString('o'); event = 'state_change'; alerts = @($alerts); error = $errorDetail }
    ($alertLine | ConvertTo-Json -Compress -Depth 5) | Add-Content -LiteralPath $LogPath -Encoding utf8
    $previousAlerts = $alertKey
  }

  $nextCheck = [DateTimeOffset]::UtcNow.AddSeconds($IntervalSeconds)
  while ([DateTimeOffset]::UtcNow -lt $nextCheck -and [DateTimeOffset]::UtcNow -lt $deadline) {
    Start-Sleep -Seconds ([Math]::Min(60, [Math]::Max(1, $IntervalSeconds)))
  }
}

$end = [ordered]@{ timestamp = [DateTimeOffset]::UtcNow.ToString('o'); event = 'observation_finished'; durationHours = $DurationHours }
($end | ConvertTo-Json -Compress) | Add-Content -LiteralPath $LogPath -Encoding utf8

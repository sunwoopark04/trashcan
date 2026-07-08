$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8000
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
$listener.Start()

Write-Host "Serving $root at http://localhost:$port/"

function Get-ContentType([string]$path) {
  switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
    ".html" { "text/html; charset=utf-8" }
    ".css" { "text/css; charset=utf-8" }
    ".js" { "application/javascript; charset=utf-8" }
    ".json" { "application/json; charset=utf-8" }
    ".png" { "image/png" }
    ".jpg" { "image/jpeg" }
    ".jpeg" { "image/jpeg" }
    ".svg" { "image/svg+xml" }
    ".ico" { "image/x-icon" }
    default { "application/octet-stream" }
  }
}

function Get-FileBytes([string]$filePath) {
  if (Test-Path $filePath -PathType Leaf) {
    return [System.IO.File]::ReadAllBytes($filePath)
  }
  return $null
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $buffer = New-Object byte[] 8192
      $requestText = ""
      do {
        $read = $stream.Read($buffer, 0, $buffer.Length)
        if ($read -le 0) { break }
        $requestText += [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read)
      } while ($requestText -notmatch "`r`n`r`n")

      $requestLine = ($requestText -split "`r`n")[0]
      if ($requestLine -match '^GET\s+(\S+)\s+HTTP/') {
        $path = $Matches[1]
      } else {
        $path = "/"
      }

      $relativePath = [Uri]::UnescapeDataString($path.TrimStart("/"))
      if ([string]::IsNullOrWhiteSpace($relativePath)) {
        $relativePath = "index.html"
      }

      $filePath = Join-Path $root $relativePath
      $bytes = Get-FileBytes $filePath

      if ($bytes -ne $null) {
        $header = "HTTP/1.1 200 OK`r`nContent-Type: $(Get-ContentType $filePath)`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
        $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
        $stream.Write($headerBytes, 0, $headerBytes.Length)
        $stream.Write($bytes, 0, $bytes.Length)
      } else {
        $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
        $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
        $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
        $stream.Write($headerBytes, 0, $headerBytes.Length)
        $stream.Write($body, 0, $body.Length)
      }

      $stream.Flush()
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
  $listener.Server.Close()
}

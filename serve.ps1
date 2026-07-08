$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:8000/")
$listener.Start()

Write-Host "Serving $root at http://localhost:8000/"

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

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $requestPath = $context.Request.Url.AbsolutePath.TrimStart("/")

    if ([string]::IsNullOrWhiteSpace($requestPath)) {
      $requestPath = "index.html"
    }

    $filePath = Join-Path $root $requestPath

    if (Test-Path $filePath -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($filePath)
      $context.Response.StatusCode = 200
      $context.Response.ContentType = Get-ContentType $filePath
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $notFound = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
      $context.Response.StatusCode = 404
      $context.Response.ContentType = "text/plain; charset=utf-8"
      $context.Response.OutputStream.Write($notFound, 0, $notFound.Length)
    }

    $context.Response.OutputStream.Close()
  }
} finally {
  if ($listener.IsListening) {
    $listener.Stop()
  }
  $listener.Close()
}

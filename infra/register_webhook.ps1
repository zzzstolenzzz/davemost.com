#Requires -Version 5.1
<#
.SYNOPSIS
  Registers the Telegram webhook after `terraform apply`.
  Run from inside the infra/ directory.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "Reading Terraform outputs..."
$webhookUrl    = terraform output -raw webhook_url
$webhookSecret = terraform output -raw webhook_secret
$secretName    = terraform output -raw bot_token_secret_arn

Write-Host "Fetching bot token from Secrets Manager..."
$botToken = aws secretsmanager get-secret-value `
  --secret-id $secretName `
  --query SecretString `
  --output text

if (-not $botToken -or $botToken -eq "None") {
  Write-Error "Bot token not found in Secrets Manager. Store it first:`n  aws secretsmanager put-secret-value --secret-id davemost/telegram-bot-token --secret-string YOUR_TOKEN"
  exit 1
}

Write-Host "Registering webhook: $webhookUrl"

$body = [ordered]@{
  url             = $webhookUrl
  secret_token    = $webhookSecret
  max_connections = 10
  allowed_updates = @("message")
} | ConvertTo-Json

$response = Invoke-RestMethod `
  -Uri "https://api.telegram.org/bot${botToken}/setWebhook" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body

if ($response.ok) {
  Write-Host "Webhook registered successfully."
  Write-Host "  URL: $webhookUrl"
} else {
  Write-Error "Telegram returned an error: $($response | ConvertTo-Json)"
}

Write-Host "Registering bot command menu..."

$commandsBody = @{
  commands = @(
    @{ command = "list";   description = "List everything I've learned about Dave" },
    @{ command = "teach";  description = "Teach me a new fact: /teach <fact>" },
    @{ command = "forget"; description = "Forget facts matching a keyword" },
    @{ command = "help";   description = "Show what I can do" }
  )
} | ConvertTo-Json -Depth 5

$cmdResponse = Invoke-RestMethod `
  -Uri "https://api.telegram.org/bot${botToken}/setMyCommands" `
  -Method POST `
  -ContentType "application/json" `
  -Body $commandsBody

if ($cmdResponse.ok) {
  Write-Host "Command menu registered."
} else {
  Write-Error "setMyCommands error: $($cmdResponse | ConvertTo-Json)"
}

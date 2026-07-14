output "webhook_url" {
  description = "HTTPS URL to register with Telegram setWebhook"
  value       = "${trimsuffix(aws_apigatewayv2_stage.webhook.invoke_url, "/")}/webhook"
}

output "webhook_secret" {
  description = "Secret token sent by Telegram in X-Telegram-Bot-Api-Secret-Token header"
  value       = random_password.webhook_secret.result
  sensitive   = true
}

output "corrections_table_arn" {
  description = "ARN of the davemostCorrections DynamoDB table"
  value       = aws_dynamodb_table.corrections.arn
}

output "agent_corrections_policy_arn" {
  description = "Attach this policy to your existing chat Lambda's IAM role to grant DynamoDB read access"
  value       = aws_iam_policy.agent_read_corrections.arn
}

output "bot_token_secret_arn" {
  description = "Secrets Manager ARN — run: aws secretsmanager put-secret-value --secret-id davemost/telegram-bot-token --secret-string YOUR_TOKEN"
  value       = aws_secretsmanager_secret.bot_token.arn
}

output "gemini_key_secret_arn" {
  description = "Secrets Manager ARN — run: aws secretsmanager put-secret-value --secret-id davemost/gemini-api-key --secret-string YOUR_KEY"
  value       = aws_secretsmanager_secret.gemini_key.arn
}

output "chat_api_url" {
  description = "Paste this URL into index.html as the API constant, then push to GitHub Pages"
  value       = "${trimsuffix(aws_apigatewayv2_stage.chat.invoke_url, "/")}/chat"
}

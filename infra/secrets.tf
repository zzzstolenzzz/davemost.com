resource "aws_secretsmanager_secret" "bot_token" {
  name        = var.bot_token_secret_name
  description = "Telegram bot token for davemost.com webhook"
}

resource "aws_secretsmanager_secret" "gemini_key" {
  name        = var.gemini_key_secret_name
  description = "Google Gemini API key for davemost.com chat agent"
}

resource "random_password" "visitor_salt" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "visitor_salt" {
  name        = var.visitor_salt_secret_name
  description = "Salt for hashing visitor network fingerprints for davemost.com chat agent"
}

resource "aws_secretsmanager_secret_version" "visitor_salt" {
  secret_id     = aws_secretsmanager_secret.visitor_salt.id
  secret_string = random_password.visitor_salt.result
}

# After terraform apply, store the actual secret values:
#   aws secretsmanager put-secret-value \
#     --secret-id davemost/telegram-bot-token \
#     --secret-string "YOUR_BOT_TOKEN_HERE"
#
#   aws secretsmanager put-secret-value \
#     --secret-id davemost/gemini-api-key \
#     --secret-string "YOUR_GEMINI_API_KEY_HERE"

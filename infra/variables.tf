variable "aws_region" {
  default = "us-east-1"
}

variable "telegram_user_id" {
  description = "Your numeric Telegram user ID (from @userinfobot) — only messages from this ID are stored"
  type        = string
}

variable "bot_token_secret_name" {
  description = "Secrets Manager secret name for the Telegram bot token"
  default     = "davemost/telegram-bot-token"
}

variable "agent_lambda_role_name" {
  description = "Name of the existing chat Lambda's IAM execution role. If set, DynamoDB read access is attached automatically."
  default     = ""
}

variable "gemini_key_secret_name" {
  description = "Secrets Manager secret name for the Google Gemini API key"
  default     = "davemost/gemini-api-key"
}

variable "visitor_salt_secret_name" {
  description = "Secrets Manager secret name for the visitor network-hash salt"
  default     = "davemost/visitor-salt"
}

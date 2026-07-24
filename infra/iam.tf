# ── Webhook Lambda execution role ────────────────────────────────────────────

resource "aws_iam_role" "webhook_lambda" {
  name = "davemost-telegram-webhook-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "webhook_lambda" {
  name = "davemost-telegram-webhook-policy"
  role = aws_iam_role.webhook_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DynamoReadWrite"
        Effect = "Allow"
        Action = ["dynamodb:PutItem", "dynamodb:Scan", "dynamodb:DeleteItem"]
        Resource = aws_dynamodb_table.corrections.arn
      },
      {
        Sid      = "VisitorsReadWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.visitors.arn
      },
      {
        Sid    = "SecretsRead"
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.bot_token.arn]
      },
      {
        Sid    = "Logs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# ── Policy for existing agent Lambda to read corrections ──────────────────────

resource "aws_iam_policy" "agent_read_corrections" {
  name        = "davemost-agent-read-corrections"
  description = "Allows the chat agent Lambda to scan davemostCorrections for system-prompt context"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "DynamoRead"
      Effect   = "Allow"
      Action   = ["dynamodb:Scan", "dynamodb:GetItem"]
      Resource = aws_dynamodb_table.corrections.arn
    }]
  })
}

# Attach automatically if agent_lambda_role_name is provided.
# Otherwise attach manually: aws iam attach-role-policy --role-name <ROLE> --policy-arn <outputs.agent_corrections_policy_arn>
resource "aws_iam_role_policy_attachment" "agent_corrections" {
  count      = var.agent_lambda_role_name != "" ? 1 : 0
  role       = var.agent_lambda_role_name
  policy_arn = aws_iam_policy.agent_read_corrections.arn
}

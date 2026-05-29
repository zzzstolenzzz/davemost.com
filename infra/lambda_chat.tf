data "archive_file" "chat" {
  type        = "zip"
  source_dir  = "${path.module}/functions/chat"
  output_path = "${path.module}/dist/chat.zip"
}

# ── IAM role ─────────────────────────────────────────────────────────────────

resource "aws_iam_role" "chat_lambda" {
  name = "davemost-chat-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "chat_lambda" {
  name = "davemost-chat-lambda-policy"
  role = aws_iam_role.chat_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "DynamoRead"
        Effect   = "Allow"
        Action   = ["dynamodb:Scan", "dynamodb:GetItem"]
        Resource = aws_dynamodb_table.corrections.arn
      },
      {
        Sid    = "SecretsRead"
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [
          aws_secretsmanager_secret.bot_token.arn,
          aws_secretsmanager_secret.gemini_key.arn,
        ]
      },
      {
        Sid    = "Logs"
        Effect = "Allow"
        Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# ── Lambda function ───────────────────────────────────────────────────────────

resource "aws_lambda_function" "chat" {
  function_name    = "davemost-chat"
  filename         = data.archive_file.chat.output_path
  source_code_hash = data.archive_file.chat.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  role             = aws_iam_role.chat_lambda.arn
  timeout          = 30

  environment {
    variables = {
      TABLE_NAME          = aws_dynamodb_table.corrections.name
      TELEGRAM_USER_ID    = var.telegram_user_id
      GEMINI_SECRET_ARN   = aws_secretsmanager_secret.gemini_key.arn
      TELEGRAM_SECRET_ARN = aws_secretsmanager_secret.bot_token.arn
    }
  }
}

# ── API Gateway v2 ────────────────────────────────────────────────────────────

resource "aws_apigatewayv2_api" "chat" {
  name          = "davemost-chat"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["POST", "OPTIONS"]
    allow_headers = ["Content-Type"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_integration" "chat" {
  api_id                 = aws_apigatewayv2_api.chat.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.chat.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "chat" {
  api_id    = aws_apigatewayv2_api.chat.id
  route_key = "POST /chat"
  target    = "integrations/${aws_apigatewayv2_integration.chat.id}"
}

resource "aws_apigatewayv2_stage" "chat" {
  api_id      = aws_apigatewayv2_api.chat.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "chat_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.chat.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.chat.execution_arn}/*/*/chat"
}

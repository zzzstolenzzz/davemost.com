data "archive_file" "webhook" {
  type        = "zip"
  source_dir  = "${path.module}/functions/telegram-webhook"
  output_path = "${path.module}/dist/telegram-webhook.zip"
}

resource "aws_lambda_function" "webhook" {
  function_name    = "davemost-telegram-webhook"
  filename         = data.archive_file.webhook.output_path
  source_code_hash = data.archive_file.webhook.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  role             = aws_iam_role.webhook_lambda.arn
  timeout          = 10

  environment {
    variables = {
      TABLE_NAME          = aws_dynamodb_table.corrections.name
      TELEGRAM_USER_ID    = var.telegram_user_id
      WEBHOOK_SECRET      = random_password.webhook_secret.result
      TELEGRAM_SECRET_ARN = aws_secretsmanager_secret.bot_token.arn
      CHAT_API_URL        = "${trimsuffix(aws_apigatewayv2_stage.chat.invoke_url, "/")}/chat"
    }
  }
}

# ── HTTP API (API Gateway v2) ─────────────────────────────────────────────────

resource "aws_apigatewayv2_api" "webhook" {
  name          = "davemost-telegram-webhook"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "webhook" {
  api_id                 = aws_apigatewayv2_api.webhook.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.webhook.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "webhook" {
  api_id    = aws_apigatewayv2_api.webhook.id
  route_key = "POST /webhook"
  target    = "integrations/${aws_apigatewayv2_integration.webhook.id}"
}

resource "aws_apigatewayv2_stage" "webhook" {
  api_id      = aws_apigatewayv2_api.webhook.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "webhook_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.webhook.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.webhook.execution_arn}/*/*/webhook"
}

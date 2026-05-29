aws_region       = "us-east-1"
telegram_user_id = "5323094741"

# Optional: set this to auto-attach DynamoDB read access to your existing chat Lambda's role.
# Find the role name with:
#   aws lambda get-function-configuration --function-name YOUR_LAMBDA_NAME --query Role --output text
# agent_lambda_role_name = ""

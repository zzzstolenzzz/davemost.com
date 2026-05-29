import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "crypto";

const dynamo = new DynamoDBClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const AUTHORIZED_USER_ID = Number(process.env.TELEGRAM_USER_ID);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

export const handler = async (event) => {
  // Validate the Telegram webhook secret token to reject spoofed requests
  const incomingSecret = event.headers?.["x-telegram-bot-api-secret-token"];
  if (WEBHOOK_SECRET && incomingSecret !== WEBHOOK_SECRET) {
    return { statusCode: 403, body: "Forbidden" };
  }

  let update;
  try {
    update = JSON.parse(event.body ?? "{}");
  } catch {
    return { statusCode: 200, body: "ok" };
  }

  const message = update?.message;
  if (!message?.text) return { statusCode: 200, body: "ok" };

  // Ignore messages not from the authorized user
  if (AUTHORIZED_USER_ID && message.from?.id !== AUTHORIZED_USER_ID) {
    return { statusCode: 200, body: "ok" };
  }

  // Build the correction record.
  // When you reply to a bot message, reply_to_message.text is the bot's original response.
  const botMessage = message.reply_to_message?.text ?? null;

  const item = {
    id:        { S: randomUUID() },
    timestamp: { S: new Date().toISOString() },
    correction: { S: message.text },
    chatId:    { S: String(message.chat.id) },
    messageId: { N: String(message.message_id) },
  };

  if (botMessage) {
    item.botMessage = { S: botMessage };
  }

  await dynamo.send(new PutItemCommand({ TableName: TABLE_NAME, Item: item }));

  // Always 200 so Telegram doesn't retry
  return { statusCode: 200, body: "ok" };
};

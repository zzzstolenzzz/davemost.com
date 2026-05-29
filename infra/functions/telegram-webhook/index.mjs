import { DynamoDBClient, PutItemCommand, ScanCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { randomUUID } from "crypto";

const dynamo = new DynamoDBClient({});
const sm = new SecretsManagerClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const AUTHORIZED_USER_ID = Number(process.env.TELEGRAM_USER_ID);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const TELEGRAM_SECRET_ARN = process.env.TELEGRAM_SECRET_ARN;

let telegramToken = null;

async function getToken() {
  if (!telegramToken) {
    const { SecretString } = await sm.send(new GetSecretValueCommand({ SecretId: TELEGRAM_SECRET_ARN }));
    telegramToken = SecretString;
  }
  return telegramToken;
}

async function reply(chatId, replyToMessageId, text) {
  try {
    const token = await getToken();
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, reply_to_message_id: replyToMessageId }),
    });
  } catch {
    // Fire-and-forget
  }
}

async function forgetFact(keyword) {
  const { Items = [] } = await dynamo.send(new ScanCommand({ TableName: TABLE_NAME }));
  const lower = keyword.toLowerCase();
  const matches = Items.filter((item) =>
    item.correction?.S?.toLowerCase().includes(lower)
  );
  await Promise.all(
    matches.map((item) =>
      dynamo.send(new DeleteItemCommand({ TableName: TABLE_NAME, Key: { id: item.id } }))
    )
  );
  return matches.length;
}

export const handler = async (event) => {
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

  if (AUTHORIZED_USER_ID && message.from?.id !== AUTHORIZED_USER_ID) {
    return { statusCode: 200, body: "ok" };
  }

  const chatId = message.chat.id;
  const msgId = message.message_id;
  const text = message.text.trim();

  // FORGET command: delete facts containing the keyword
  if (text.toUpperCase().startsWith("FORGET:")) {
    const keyword = text.slice("FORGET:".length).trim();
    if (!keyword) {
      await reply(chatId, msgId, "Usage: FORGET: <keyword or phrase>");
      return { statusCode: 200, body: "ok" };
    }
    const count = await forgetFact(keyword);
    await reply(
      chatId,
      msgId,
      count > 0
        ? `🗑️ Forgot ${count} fact${count > 1 ? "s" : ""} matching "${keyword}".`
        : `Nothing found matching "${keyword}".`
    );
    return { statusCode: 200, body: "ok" };
  }

  // Otherwise store as a new correction/fact
  const botMessage = message.reply_to_message?.text ?? null;

  const item = {
    id:        { S: randomUUID() },
    timestamp: { S: new Date().toISOString() },
    correction: { S: text },
    chatId:    { S: String(chatId) },
    messageId: { N: String(msgId) },
  };

  if (botMessage) {
    item.botMessage = { S: botMessage };
  }

  await dynamo.send(new PutItemCommand({ TableName: TABLE_NAME, Item: item }));
  await reply(chatId, msgId, "✅ Got it — I'll remember that.");

  return { statusCode: 200, body: "ok" };
};

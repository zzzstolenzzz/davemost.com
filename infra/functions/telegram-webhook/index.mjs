import { DynamoDBClient, PutItemCommand, ScanCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { randomUUID } from "crypto";

const dynamo = new DynamoDBClient({});
const sm = new SecretsManagerClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const AUTHORIZED_USER_ID = Number(process.env.TELEGRAM_USER_ID);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const TELEGRAM_SECRET_ARN = process.env.TELEGRAM_SECRET_ARN;
const CHAT_API_URL = process.env.CHAT_API_URL;

const HELP_TEXT = `🤖 davemost.com agent — here's what I can do:

/list — show everything I've learned about Dave
/teach <fact> — teach me something new (e.g. /teach Dave ran the 2019 marathon)
/forget <keyword> — delete facts matching a keyword
/help — show this message

You can also reply to any of my messages to add or correct a fact, or send a plain question to see what site visitors get.`;

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

async function scanAll() {
  const { Items = [] } = await dynamo.send(new ScanCommand({ TableName: TABLE_NAME, ConsistentRead: true }));
  return Items;
}

async function forgetFact(keyword) {
  const items = await scanAll();
  const lower = keyword.toLowerCase();
  const matches = items.filter((item) => item.correction?.S?.toLowerCase().includes(lower));
  await Promise.all(
    matches.map((item) =>
      dynamo.send(new DeleteItemCommand({ TableName: TABLE_NAME, Key: { id: item.id } }))
    )
  );
  return matches.length;
}

async function storeFact(chatId, msgId, correction, context) {
  const item = {
    id:         { S: randomUUID() },
    timestamp:  { S: new Date().toISOString() },
    correction: { S: correction },
    chatId:     { S: String(chatId) },
    messageId:  { N: String(msgId) },
  };
  if (context) item.botMessage = { S: context };
  await dynamo.send(new PutItemCommand({ TableName: TABLE_NAME, Item: item }));
  await reply(chatId, msgId, "✅ Got it — I'll remember that.");
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
  let text = message.text.trim();

  // Telegram slash commands (from the bot's command menu) reuse the text-command logic below.
  const slash = text.match(/^\/([a-zA-Z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (slash) {
    const cmd = slash[1].toLowerCase();
    const arg = (slash[2] || "").trim();
    if (cmd === "help" || cmd === "start") {
      await reply(chatId, msgId, HELP_TEXT);
      return { statusCode: 200, body: "ok" };
    }
    if (cmd === "list") text = "LIST";
    else if (cmd === "teach") text = "TEACH:" + arg;
    else if (cmd === "forget") text = "FORGET:" + arg;
  }

  // LIST command: show all stored facts
  if (text.toUpperCase() === "LIST") {
    const items = await scanAll();
    if (items.length === 0) {
      await reply(chatId, msgId, "No facts stored yet.");
    } else {
      const sorted = items.sort((a, b) => (a.timestamp?.S ?? "").localeCompare(b.timestamp?.S ?? ""));
      const lines = sorted.map((item, i) => `${i + 1}. ${item.correction?.S}`);
      await reply(chatId, msgId, `📋 Stored facts (${items.length}):\n\n${lines.join("\n")}`);
    }
    return { statusCode: 200, body: "ok" };
  }

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

  // TEACH command: explicitly store a fact
  if (text.toUpperCase().startsWith("TEACH:")) {
    const fact = text.slice("TEACH:".length).trim();
    if (!fact) {
      await reply(chatId, msgId, "Usage: TEACH: <fact to remember>");
      return { statusCode: 200, body: "ok" };
    }
    await storeFact(chatId, msgId, fact);
    return { statusCode: 200, body: "ok" };
  }

  const botMessage = message.reply_to_message?.text ?? null;

  // Any reply to a bot message is Dave teaching/correcting a fact — never
  // gated on whether the bot's message was an "uncertain" alert.
  if (botMessage) {
    const questionMatch = botMessage.match(/Q: ([\s\S]*?)\nA: /);
    await storeFact(chatId, msgId, text, questionMatch ? questionMatch[1].trim() : undefined);
    return { statusCode: 200, body: "ok" };
  }

  // Default: ask the agent and reply
  try {
    const res = await fetch(CHAT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": WEBHOOK_SECRET },
      body: JSON.stringify({ message: text, _silent: true }),
    });
    const data = await res.json();
    const answer = data.reply ?? "No response.";
    const suffix = data._uncertain ? "\n\n⚠️ Not sure — reply to this message to correct me." : "";
    await reply(chatId, msgId, answer + suffix);
  } catch (err) {
    await reply(chatId, msgId, `Error: ${err.message}`);
  }

  return { statusCode: 200, body: "ok" };
};

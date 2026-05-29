import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const dynamo = new DynamoDBClient({});
const sm = new SecretsManagerClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const TELEGRAM_USER_ID = process.env.TELEGRAM_USER_ID;
const GEMINI_SECRET_ARN = process.env.GEMINI_SECRET_ARN;
const TELEGRAM_SECRET_ARN = process.env.TELEGRAM_SECRET_ARN;

// Cached across warm invocations
let geminiKey = null;
let telegramToken = null;

async function loadSecrets() {
  const [g, t] = await Promise.all([
    sm.send(new GetSecretValueCommand({ SecretId: GEMINI_SECRET_ARN })),
    sm.send(new GetSecretValueCommand({ SecretId: TELEGRAM_SECRET_ARN })),
  ]);
  geminiKey = g.SecretString;
  telegramToken = t.SecretString;
}

// Minimal DynamoDB unmarshaller — handles S and N which is all we store
function demarshall(item) {
  const out = {};
  for (const [key, typedVal] of Object.entries(item)) {
    const [[type, value]] = Object.entries(typedVal);
    out[key] = type === "N" ? Number(value) : value;
  }
  return out;
}

async function getCorrections() {
  const { Items = [] } = await dynamo.send(new ScanCommand({ TableName: TABLE_NAME }));
  return Items.map(demarshall).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function buildSystemPrompt(corrections) {
  let prompt = `You are a personal AI agent for Dave Most, accessible at davemost.com.
Your only job is to answer questions about Dave Most — his background, work, interests, projects, and life.

Rules you must follow without exception:
1. If the question is not about Dave Most (e.g. asks for code, general facts, help with other topics), respond with exactly this single word and nothing else: POLICY_REJECT
2. If the question asks about Dave's family, children, or kids, respond with exactly this single word and nothing else: POLICY_REJECT
3. If the question is about Dave but you are uncertain or lack the information to answer confidently, start your response with exactly: [UNCERTAIN]:
4. Keep answers concise and conversational.

Known facts about Dave Most:
- He runs davemost.com
- He is a software developer and entrepreneur`;

  if (corrections.length > 0) {
    const lines = corrections.map((c) => {
      const ctx = c.botMessage ? `(context: "${c.botMessage}") ` : "";
      return `- ${ctx}${c.correction}`;
    });
    prompt +=
      "\n\nFacts Dave has personally confirmed — treat these as ground truth:\n" +
      lines.join("\n");
  }

  return prompt;
}

async function sendTelegram(text) {
  if (!telegramToken || !TELEGRAM_USER_ID) return;
  try {
    const body = text.length > 4000 ? text.slice(0, 3997) + "..." : text;
    await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_USER_ID, text: body }),
    });
  } catch {
    // Fire-and-forget — never fail a user request over a Telegram hiccup
  }
}

async function callGemini(systemPrompt, userMessage) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

export const handler = async (event) => {
  let message;
  try {
    ({ message } = JSON.parse(event.body ?? "{}"));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Bad request" }) };
  }

  if (!message?.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: "Empty message" }) };
  }

  if (!geminiKey || !telegramToken) await loadSecrets();

  const corrections = await getCorrections();
  const systemPrompt = buildSystemPrompt(corrections);

  let raw;
  try {
    raw = await callGemini(systemPrompt, message);
  } catch {
    return {
      statusCode: 502,
      body: JSON.stringify({ reply: "Agent unavailable. Try again shortly." }),
    };
  }

  const trimmed = raw.trim();

  // Policy enforcement
  if (trimmed === "POLICY_REJECT") {
    await sendTelegram(`🚫 BLOCKED (not about Dave)\nQ: ${message}`);
    return {
      statusCode: 200,
      body: JSON.stringify({
        reply: "I'm only here to talk about Dave Most. I can't help with code generation or other topics.",
      }),
    };
  }

  // Uncertainty detection
  let reply = trimmed;
  let uncertain = false;
  if (reply.startsWith("[UNCERTAIN]:")) {
    uncertain = true;
    reply = reply.slice("[UNCERTAIN]:".length).trim();
  }

  // Telegram logging
  if (uncertain) {
    await sendTelegram(
      `⚠️ UNCERTAIN — reply to this message to teach me a new fact!\n\nQ: ${message}\nA: ${reply}`
    );
  } else {
    await sendTelegram(`Q: ${message}\nA: ${reply}`);
  }

  return { statusCode: 200, body: JSON.stringify({ reply }) };
};

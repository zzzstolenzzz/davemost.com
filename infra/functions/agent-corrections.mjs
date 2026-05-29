// Add this to your existing chat Lambda.
// Requires DynamoDB Scan permission on davemostCorrections (policy ARN in terraform outputs).

import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const dynamo = new DynamoDBClient({});

async function getCorrections() {
  const { Items = [] } = await dynamo.send(
    new ScanCommand({ TableName: "davemostCorrections" })
  );
  return Items.map(unmarshall).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// Call this when building your system prompt:
export async function buildSystemPrompt(basePrompt) {
  const corrections = await getCorrections();

  if (corrections.length === 0) return basePrompt;

  const correctionLines = corrections.map((c) => {
    const context = c.botMessage ? `Re: "${c.botMessage}" → ` : "";
    return `- ${context}${c.correction}`;
  });

  return (
    basePrompt +
    "\n\nCorrections from previous conversations (treat these as ground truth):\n" +
    correctionLines.join("\n")
  );
}

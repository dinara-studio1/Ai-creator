const { runTool } = require("./registry");

const MAX_ROUNDS = 2;
const MAX_TOOL_CALLS = 3;
const MAX_TOOL_RESULT = 4000;

function relaxImages(messages) {
  for (const message of messages) {
    if (!Array.isArray(message?.content)) continue;
    message.content = message.content.map((part) => {
      if (part?.type !== "image_url" || !part.image_url?.url) return part;
      return { type: "image_url", image_url: { url: part.image_url.url } };
    });
  }
}

function hasImages(messages) {
  return messages.some(
    (message) => Array.isArray(message?.content) && message.content.some((part) => part?.type === "image_url")
  );
}

function stripImages(messages) {
  for (const message of messages) {
    if (!Array.isArray(message?.content)) continue;
    const text = message.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n\n")
      .trim();
    message.content = text || "Клиент прислал изображение, его не удалось открыть. Ответь по тексту вопроса.";
  }
}

function timeoutError() {
  const err = new Error("AI timeout");
  err.name = "TimeoutError";
  return err;
}

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return Array.isArray(raw) ? {} : raw;
  const text = String(raw);
  if (text.length > 8000) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toolContent(output) {
  let text;
  try {
    text = JSON.stringify(output);
  } catch {
    return JSON.stringify({ error: "Функция вернула нечитаемый результат" });
  }
  if (text.length <= MAX_TOOL_RESULT) return text;
  return JSON.stringify({
    note: "Результат сокращён",
    preview: text.slice(0, 500),
  });
}

function safeArguments(raw) {
  try {
    return JSON.stringify(parseArgs(raw));
  } catch {
    return "{}";
  }
}

function usableCalls(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((call) => call && call.id && call.function && typeof call.function.name === "string")
    .slice(0, MAX_TOOL_CALLS)
    .map((call) => ({
      id: String(call.id),
      type: "function",
      function: {
        name: call.function.name,
        arguments: safeArguments(call.function.arguments),
      },
    }));
}

function rememberCards(cards, name, output) {
  if (name !== "search_catalog" || !Array.isArray(output?.products)) return;
  for (const card of output.products) {
    if (!card || !card.title || cards.some((item) => item.title === card.title)) continue;
    cards.push({
      title: String(card.title),
      description: String(card.description || ""),
      price: String(card.price || ""),
    });
    if (cards.length >= 3) return;
  }
}

async function runLoop({ client, prompt, tools, schemas, ctx, history, timeoutMs, signal }) {
  const deadline = Date.now() + timeoutMs;
  const cards = [];
  const canUseTools = Array.isArray(schemas) && schemas.length > 0;
  const messages = [{ role: "system", content: prompt(!canUseTools) }, ...history];

  const callModel = async (withTools) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeoutError();
    return client.complete({
      messages,
      tools: withTools ? schemas : null,
      timeoutMs: remaining,
      signal,
    });
  };

  const complete = async (withTools) => {
    try {
      return await callModel(withTools && canUseTools);
    } catch (err) {
      if (signal?.aborted || err?.name === "ClientClosed") throw err;
      let current = err;
      if (current?.toolsRejected && withTools) {
        console.error(`AI-чат: функции отклонены (${current.status}): ${current.message}`);
        messages[0] = { role: "system", content: prompt(true) };
        relaxImages(messages);
        try {
          return await callModel(false);
        } catch (retryErr) {
          current = retryErr;
        }
      }
      if (current?.name === "AiHttpError" && (current.status === 400 || current.status === 422) && hasImages(messages)) {
        console.error(`AI-чат: изображение отклонено (${current.status}): ${current.message}`);
        stripImages(messages);
        return callModel(false);
      }
      throw current;
    }
  };

  let result = await complete(canUseTools);

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const calls = usableCalls(result.toolCalls);
    if (!calls.length) return { reply: result.content, cards, finishReason: result.finishReason };

    messages.push({
      role: "assistant",
      content: result.content || "",
      tool_calls: calls,
    });
    for (const call of calls) {
      const output = await runTool(tools, call.function.name, parseArgs(call.function.arguments), ctx);
      rememberCards(cards, call.function.name, output);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: toolContent(output),
      });
    }

    const forceText = round === MAX_ROUNDS - 1;
    result = await complete(!forceText);
  }

  return { reply: result.content, cards, finishReason: result.finishReason };
}

module.exports = { runLoop };

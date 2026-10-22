const TRANSIENT_STATUS = new Set([502, 503, 504]);

function isTransientStatus(status) {
  return TRANSIENT_STATUS.has(status);
}

class AiHttpError extends Error {
  constructor(message, { status, toolsRejected, transient, retryAfterMs = null }) {
    super(message);
    this.name = "AiHttpError";
    this.status = status;
    this.toolsRejected = Boolean(toolsRejected);
    this.transient = transient != null ? Boolean(transient) : isTransientStatus(status);
    this.retryAfterMs = retryAfterMs == null ? null : Number(retryAfterMs);
  }
}

function retryDelayMs(response) {
  const raw = String(response.headers?.get("retry-after") || "").trim();
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
  }
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - Date.now());
}

function messageText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part.text === "string") return part.text;
      return "";
    })
    .join("")
    .trim();
}

function toolsWereRejected(status, sentTools) {
  // Прокси часто отклоняют поле tools своим текстом ошибки, без слова tool.
  // Повтор без функций имеет смысл только для 400/422 и только если функции вообще отправлялись.
  return Boolean(sentTools) && (status === 400 || status === 422);
}

function clientClosed() {
  const err = new Error("client closed");
  err.name = "ClientClosed";
  return err;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(clientClosed());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(clientClosed());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function requestChat({ baseUrl, apiKey, model, reasoningEffort, maxCompletionTokens, messages, tools, timeoutMs, signal: external }) {
  const payload = { model, max_completion_tokens: maxCompletionTokens || 2000, messages };
  if (reasoningEffort) payload.reasoning_effort = reasoningEffort;
  if (tools && tools.length) payload.tools = tools;

  const signals = [AbortSignal.timeout(Math.max(1, timeoutMs))];
  if (external) signals.push(external);
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.any(signals),
    });
  } catch (err) {
    if (external?.aborted) throw clientClosed();
    throw err;
  }

  const raw = await response.text();
  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      const snippet = raw.replace(/\s+/g, " ").trim().slice(0, 180);
      console.error(`AI-чат: ответ API не JSON (HTTP ${response.status}): ${snippet || response.statusText}`);
      const retryAfterMs = response.status === 429 ? retryDelayMs(response) : null;
      throw new AiHttpError(snippet || response.statusText || "Ответ API не JSON", {
        status: response.ok ? 502 : response.status,
        toolsRejected: toolsWereRejected(response.status, tools && tools.length),
        transient: response.status === 429 ? retryAfterMs != null : (response.ok ? true : undefined),
        retryAfterMs,
      });
    }
  } else if (!response.ok) {
    console.error(`AI-чат: ответ API без тела (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const detail = data?.error?.message || response.statusText || "Ошибка API";
    const retryAfterMs = response.status === 429 ? retryDelayMs(response) : null;
    throw new AiHttpError(detail, {
      status: response.status,
      toolsRejected: toolsWereRejected(response.status, tools && tools.length),
      transient: response.status === 429 ? retryAfterMs != null : undefined,
      retryAfterMs,
    });
  }

  const choice = data?.choices?.[0];
  const message = choice?.message || {};
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return {
    content: messageText(message.content),
    toolCalls,
    finishReason: choice?.finish_reason || "",
  };
}

async function completeChat(options) {
  const started = Date.now();
  try {
    return await requestChat(options);
  } catch (err) {
    if (options.signal?.aborted) throw clientClosed();
    const remaining = (Number(options.timeoutMs) || 0) - (Date.now() - started);
    if (!err?.transient || remaining < 1500) throw err;
    const waitMs = err.status === 429
      ? Math.max(0, Number(err.retryAfterMs) || 0)
      : Math.min(800, Math.floor(remaining / 4));
    if (err.status === 429 && !(err.retryAfterMs >= 0)) throw err;
    if (waitMs + 400 >= remaining) throw err;
    await wait(waitMs, options.signal);
    return requestChat({ ...options, timeoutMs: Math.max(1, remaining - waitMs - 400) });
  }
}

module.exports = { AiHttpError, completeChat, toolsWereRejected, isTransientStatus };

// Новая функция — файл в ./tools с полями name, description, parameters и run(args, ctx).
// Сервер подхватывает её при запуске. ctx умеет только читать каталог и контакты.
const fs = require("fs");
const path = require("path");

const TOOLS_DIR = path.join(__dirname, "tools");

const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function takeTool(tool, file, seen) {
  if (!tool || typeof tool.name !== "string" || typeof tool.run !== "function") {
    return { error: `AI-чат: функция ${file} без name или run` };
  }
  if (!TOOL_NAME_RE.test(tool.name)) {
    return { error: `AI-чат: имя функции «${tool.name}» в ${file} недопустимо` };
  }
  if (seen.has(tool.name)) {
    return { error: `AI-чат: функция ${tool.name} уже есть, ${file} пропущен` };
  }
  seen.add(tool.name);
  return { tool };
}

function loadTools() {
  let files = [];
  try {
    files = fs.readdirSync(TOOLS_DIR).filter((name) => name.endsWith(".js")).sort();
  } catch (err) {
    console.error(`AI-чат: папка функций недоступна: ${err.message}`);
    return [];
  }

  const tools = [];
  const seen = new Set();
  for (const file of files) {
    let tool;
    try {
      tool = require(path.join(TOOLS_DIR, file));
    } catch (err) {
      console.error(`AI-чат: функция ${file} не загрузилась: ${err.message}`);
      continue;
    }
    const accepted = takeTool(tool, file, seen);
    if (accepted.error) {
      console.error(accepted.error);
      continue;
    }
    tools.push(accepted.tool);
  }
  return tools;
}

function toolSchemas(tools) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: String(tool.description || ""),
      parameters: tool.parameters || { type: "object", properties: {}, additionalProperties: false },
    },
  }));
}

async function runTool(tools, name, args, ctx) {
  const tool = tools.find((item) => item.name === name);
  if (!tool) return { error: `Неизвестная функция: ${name}` };
  try {
    const input = args && typeof args === "object" && !Array.isArray(args) ? args : {};
    const result = await tool.run(input, ctx);
    return result && typeof result === "object" ? result : { ok: true };
  } catch (err) {
    if (err?.name === "CatalogReadError") throw err;
    console.error(`AI-чат: функция ${name} не выполнилась: ${err?.message || err}`);
    return { error: "Функция не выполнилась" };
  }
}

module.exports = { loadTools, toolSchemas, runTool, takeTool };

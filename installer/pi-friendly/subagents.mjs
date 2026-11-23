// Subagents for «Просто pi».
//
// Adapted from the pi example extension snapshotted in ./vendor/pi-subagent
// (pi-coding-agent 0.84.4, MIT). The vendored copy is the fixed reference;
// this module is the executable adaptation that also relays a live snapshot
// of every subagent to the web interface.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const BUILTIN_AGENTS_DIR = fileURLToPath(new URL('./subagents/agents/', import.meta.url));

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
export const OUTPUT_CAP = 50 * 1024;
const ITEM_CAP = 40;
const SNAPSHOT_CAP = 24;

const EMPTY_USAGE = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 });
const FINAL_OUTPUT_RULES = `

Правила финального ответа дочернего агента:
- Верни только результат порученной задачи, проверенные находки или изменения.
- Не показывай внутренние рассуждения, служебные заметки и план действий.
- Не описывай недоступность браузера, Playwright, CDP или других инструментов, если это не является самим результатом задачи.
- Если выполнить задачу нельзя, напиши одну короткую причину и что именно нужно от основного агента.
`;

/* ============================== agent discovery ============================== */

function frontmatterValue(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  return value.replace(/^["']|["']$/g, '');
}

export function parseAgentMarkdown(content) {
  const text = String(content ?? '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return { frontmatter: {}, body: text.trim() };
  const end = text.indexOf('\n---', 4);
  if (end < 0) return { frontmatter: {}, body: text.trim() };
  const block = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n+/, '').trim();
  const frontmatter = {};
  for (const line of block.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    frontmatter[match[1]] = frontmatterValue(match[2]);
  }
  return { frontmatter, body };
}

function normaliseTools(value) {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const tools = raw
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  return tools.length ? tools : undefined;
}

function loadAgentsFromDir(dir, source) {
  const agents = [];
  if (!dir) return agents;
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return agents;
  }
  for (const entry of entries) {
    if (!entry.name.endsWith('.md')) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const filePath = join(dir, entry.name);
    let content = '';
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const { frontmatter, body } = parseAgentMarkdown(content);
    if (typeof frontmatter.name !== 'string' || typeof frontmatter.description !== 'string') continue;
    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: normaliseTools(frontmatter.tools),
      model: typeof frontmatter.model === 'string' ? frontmatter.model : undefined,
      systemPrompt: body,
      source,
      filePath,
    });
  }
  return agents;
}

function findNearestProjectAgentsDir(cwd) {
  let current = resolve(cwd || '.');
  while (true) {
    const candidate = join(current, '.pi', 'agents');
    try {
      if (statSync(candidate).isDirectory()) return candidate;
    } catch {}
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Load built-in agents, then user agents (they override same names) and,
 * optionally, project-local agents from .pi/agents.
 */
export function discoverAgents({ cwd, userDir, builtinDir, scope = 'user' } = {}) {
  const projectAgentsDir = scope === 'user' ? null : findNearestProjectAgentsDir(cwd);
  const builtin = loadAgentsFromDir(builtinDir, 'builtin');
  const user = scope === 'project' ? [] : loadAgentsFromDir(userDir, 'user');
  const project = scope === 'user' || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, 'project');
  const map = new Map();
  for (const agent of builtin) map.set(agent.name, agent);
  for (const agent of user) map.set(agent.name, agent);
  for (const agent of project) map.set(agent.name, agent);
  return { agents: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)), projectAgentsDir };
}

export function formatAgentList(agents, maxItems = 12) {
  if (!agents.length) return 'нет доступных агентов';
  return agents
    .slice(0, maxItems)
    .map((agent) => `${agent.name} (${agent.source}): ${agent.description}`)
    .join('; ');
}

/* ============================== helpers ============================== */

const tail = (value, limit) => {
  const text = String(value ?? '');
  return text.length > limit ? text.slice(-limit) : text;
};

const capBytes = (value, limit = OUTPUT_CAP) => {
  const text = String(value ?? '');
  if (Buffer.byteLength(text, 'utf8') <= limit) return text;
  let result = text.slice(-limit);
  while (Buffer.byteLength(result, 'utf8') > limit) result = result.slice(1);
  return `[начало вывода скрыто]\n${result}`;
};

export function describeTool(name, args = {}) {
  const file = String(args.path || args.file_path || '')
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1);
  const suffix = file ? ` · ${file}` : '';
  if (name === 'bash') {
    const command = String(args.command || '').replace(/\s+/g, ' ').trim();
    return `Команда ${command ? `· ${tail(command, 80)}` : ''}`.trim();
  }
  if (name === 'read') return `Читает файл${suffix}`;
  if (name === 'write') return `Создаёт файл${suffix}`;
  if (name === 'edit') return `Правит файл${suffix}`;
  if (name === 'grep') return `Ищет ${args.pattern ? `/${args.pattern}/` : 'в коде'}`;
  if (name === 'find') return `Ищет файлы${args.pattern ? ` · ${args.pattern}` : ''}`;
  if (name === 'ls') return `Смотрит папку${suffix}`;
  return `Действие · ${name}`;
}

function extractText(message) {
  const content = typeof message?.content === 'string' ? [{ type: 'text', text: message.content }] : message?.content || [];
  return content
    .filter((part) => part?.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function extractThinking(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .filter((part) => part?.type === 'thinking')
    .map((part) => part.thinking)
    .join('\n\n')
    .trim();
}

function addUsage(usage, reported) {
  if (!reported) return usage;
  usage.input += Number(reported.input) || 0;
  usage.output += Number(reported.output) || 0;
  usage.cacheRead += Number(reported.cacheRead) || 0;
  usage.cacheWrite += Number(reported.cacheWrite) || 0;
  usage.cost += Number(reported.cost?.total ?? reported.cost) || 0;
  if (Number(reported.totalTokens)) usage.contextTokens = Number(reported.totalTokens);
  return usage;
}

function getPiInvocation(cli, args) {
  if (cli) return { command: process.execPath, args: [cli, ...args] };
  const script = process.argv[1];
  if (script && !script.startsWith('/$bunfs/root/') && existsSync(script)) {
    return { command: process.execPath, args: [script, ...args] };
  }
  const execName = basename(process.execPath).toLowerCase();
  if (/^(node|bun)(\.exe)?$/.test(execName)) return { command: 'pi', args };
  return { command: process.execPath, args };
}

async function writePromptFile(agentName, prompt) {
  const dir = await mkdtemp(join(tmpdir(), 'pi-friendly-agent-'));
  const filePath = join(dir, `prompt-${agentName.replace(/[^\w.-]+/g, '_')}.md`);
  await writeFile(filePath, prompt, { encoding: 'utf8', mode: 0o600 });
  return {
    filePath,
    async cleanup() {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {}
    },
  };
}

async function mapWithConcurrency(items, concurrency, fn) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/* ============================== service ============================== */

export function createSubagentService({
  cli,
  emit = () => {},
  spawnProcess = spawn,
  env = process.env,
  builtinDir = BUILTIN_AGENTS_DIR,
  now = () => Date.now(),
  emitDelay = 80,
  heartbeatMs = 2000,
  outputCap = OUTPUT_CAP,
} = {}) {
  const entries = new Map();
  const runtime = new Map();
  let emitTimer;
  let heartbeat;

  const publicEntry = (entry) => ({
    id: entry.id,
    agent: entry.agent,
    task: entry.task,
    status: entry.status,
    group: entry.group,
    step: entry.step,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    model: entry.model,
    current: entry.current,
    items: entry.items.slice(-ITEM_CAP),
    usage: { ...entry.usage },
    output: entry.output,
    error: entry.error,
  });

  function snapshot() {
    return [...entries.values()]
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(-SNAPSHOT_CAP)
      .map(publicEntry);
  }

  function emitNow() {
    clearTimeout(emitTimer);
    emitTimer = undefined;
    try {
      emit(snapshot());
    } catch {}
  }

  function schedule() {
    if (emitTimer) return;
    emitTimer = setTimeout(() => {
      emitTimer = undefined;
      try {
        emit(snapshot());
      } catch {}
    }, emitDelay);
    emitTimer.unref?.();
  }

  function syncHeartbeat() {
    const running = [...entries.values()].some((entry) => entry.status === 'running');
    if (running && !heartbeat) {
      heartbeat = setInterval(() => {
        try {
          emit(snapshot());
        } catch {}
      }, heartbeatMs);
      heartbeat.unref?.();
    } else if (!running && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
  }

  function pushItem(entry, item) {
    entry.items.push(item);
    if (entry.items.length > ITEM_CAP * 2) entry.items = entry.items.slice(-ITEM_CAP);
  }

  function prune() {
    if (entries.size <= 50) return;
    const finished = [...entries.values()]
      .filter((entry) => entry.status !== 'running')
      .sort((a, b) => a.startedAt - b.startedAt);
    for (const entry of finished.slice(0, entries.size - 40)) entries.delete(entry.id);
  }

  function finish(entry, { status, error, output }) {
    entry.status = status;
    entry.finishedAt = now();
    entry.current = '';
    entry.error = error ? capBytes(error, 4000) : undefined;
    if (output !== undefined) entry.output = capBytes(output, outputCap);
    runtime.delete(entry.id);
    prune();
    syncHeartbeat();
    emitNow();
  }

  async function runChild(agent, task, { cwd, inheritedModel, thinkingLevel, signal, group, step, progress }) {
    const id = randomUUID();
    const modelId = agent.model || inheritedModel?.id;
    const provider = agent.model ? undefined : inheritedModel?.provider;
    const entry = {
      id,
      agent: agent.name,
      task: capBytes(task, 4000),
      status: 'running',
      group,
      step,
      startedAt: now(),
      finishedAt: undefined,
      model: modelId || undefined,
      current: 'Запускаю агента…',
      items: [],
      usage: EMPTY_USAGE(),
      output: '',
      error: undefined,
    };
    entries.set(id, entry);
    syncHeartbeat();
    emitNow();
    progress?.();

    const args = ['--mode', 'json', '-p', '--no-session'];
    if (modelId) args.push('--model', modelId);
    if (provider) args.push('--provider', provider);
    if (!agent.model && thinkingLevel) args.push('--thinking', thinkingLevel);
    if (agent.tools?.length) args.push('--tools', agent.tools.join(','));
    args.push('--exclude-tools', 'subagent');

    let promptFile;
    try {
      if (agent.systemPrompt.trim()) {
        promptFile = await writePromptFile(agent.name, agent.systemPrompt + FINAL_OUTPUT_RULES);
        args.push('--append-system-prompt', promptFile.filePath);
      }
    } catch (error) {
      finish(entry, { status: 'error', error: `Не удалось подготовить агента: ${error.message}`, output: '' });
      return { id, agent: agent.name, task, status: 'error', output: '', error: entry.error, usage: entry.usage };
    }

    args.push(`Task: ${task}`);
    const invocation = getPiInvocation(cli, args);
    const childEnv = { ...env, PI_FRIENDLY_SUBAGENT_DEPTH: String(Number(env.PI_FRIENDLY_SUBAGENT_DEPTH || 0) + 1) };
    delete childEnv.PI_FRIENDLY_WEB_CHILD;

    let child;
    try {
      child = spawnProcess(invocation.command, invocation.args, {
        cwd: cwd || process.cwd(),
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv,
      });
    } catch (error) {
      finish(entry, { status: 'error', error: `Не удалось запустить pi: ${error.message}`, output: '' });
      return { id, agent: agent.name, task, status: 'error', output: '', error: entry.error, usage: entry.usage };
    }

    let aborted = false;
    const stop = () => {
      if (aborted) return;
      aborted = true;
      try {
        child.kill('SIGTERM');
      } catch {}
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
      }, 4000);
      timer.unref?.();
    };
    runtime.set(id, { child, stop });

    let buffer = '';
    let stderr = '';
    let streamText = '';
    let streamThinking = '';
    let stopReason;
    let errorMessage;
    let lastText = '';

    const processLine = (line) => {
      if (!line.trim()) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === 'message_start' && event.message?.role === 'assistant') {
        streamText = '';
        streamThinking = '';
        entry.current = 'Думает…';
      }
      if (event.type === 'message_update') {
        const delta = event.assistantMessageEvent;
        if (delta?.type === 'text_delta' && delta.delta) {
          streamText += delta.delta;
          entry.current = tail(streamText.replace(/\s+/g, ' ').trim(), 140);
        } else if (delta?.type === 'thinking_delta') {
          streamThinking += delta.delta || '';
          entry.current = 'Размышляет…';
        }
      }
      if (event.type === 'tool_execution_start') {
        const detail = describeTool(event.toolName, event.args || {});
        pushItem(entry, { type: 'tool', id: event.toolCallId, name: event.toolName, text: detail, status: 'running' });
        entry.current = detail;
        progress?.();
      }
      if (event.type === 'tool_execution_end') {
        const item = entry.items.find((value) => value.type === 'tool' && value.id === event.toolCallId);
        if (item) item.status = event.isError ? 'error' : 'done';
        progress?.();
      }
      if (event.type === 'message_end' && event.message) {
        const message = event.message;
        if (message.role === 'assistant') {
          entry.usage.turns += 1;
          addUsage(entry.usage, message.usage);
          if (!entry.model && message.model) entry.model = message.model;
          if (message.stopReason) stopReason = message.stopReason;
          if (message.errorMessage) errorMessage = message.errorMessage;
          const thinking = extractThinking(message) || streamThinking.trim();
          if (thinking) pushItem(entry, { type: 'thinking', text: capBytes(thinking, 8000) });
          streamThinking = '';
          const text = extractText(message) || streamText.trim();
          if (text) {
            lastText = text;
            entry.output = capBytes(text, outputCap);
            pushItem(entry, { type: 'text', text: capBytes(text, 2000) });
          }
          streamText = '';
          entry.current = 'Готовит ответ…';
          progress?.();
        }
      }
    };

    child.stdout?.setEncoding?.('utf8');
    child.stdout?.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 32 * 1024 * 1024) {
        buffer = buffer.slice(-1024 * 1024);
        stop();
        return;
      }
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        processLine(line);
      }
      schedule();
    });
    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on('data', (chunk) => {
      stderr = tail(stderr + chunk, 6000);
    });

    const exited = new Promise((resolveCode) => {
      child.on('error', () => resolveCode(1));
      child.on('close', (value) => {
        if (buffer.trim()) processLine(buffer);
        resolveCode(value ?? 0);
      });
    });
    if (signal) {
      if (signal.aborted) stop();
      else signal.addEventListener('abort', stop, { once: true });
    }

    const code = await exited;
    signal?.removeEventListener?.('abort', stop);
    if (promptFile) await promptFile.cleanup();
    runtime.delete(id);
    const status = aborted ? 'stopped' : code !== 0 || stopReason === 'error' || stopReason === 'aborted' ? 'error' : 'done';
    const error =
      status === 'error'
        ? errorMessage || tail(stderr, 1200) || `pi завершился с кодом ${code}.`
        : undefined;
    finish(entry, { status, error, output: lastText || entry.output || (status === 'error' ? error : '') });
    return {
      id,
      agent: agent.name,
      task,
      status,
      output: entry.output,
      error: entry.error,
      usage: entry.usage,
      step,
    };
  }

  function currentText(entry) {
    if (!entry) return '';
    if (entry.status === 'running') return entry.current || 'Работает…';
    if (entry.status === 'done') return entry.output || 'Готово.';
    return entry.error || (entry.status === 'stopped' ? 'Остановлено.' : 'Ошибка.');
  }

  function notify(onUpdate, mode) {
    if (!onUpdate) return;
    try {
      const list = snapshot();
      const running = list.filter((entry) => entry.status === 'running').length;
      const text = list.length === 1 ? currentText(list[0]) : `Субагенты: ${list.length - running} из ${list.length} готовы.`;
      onUpdate({ content: [{ type: 'text', text }], details: { mode, subagents: list } });
    } catch {}
  }

  async function run(params = {}, context = {}) {
    const { cwd, model, thinkingLevel, signal, onUpdate, userDir, builtinDir: agentsDir = builtinDir } = context;
    const scope = params.agentScope === 'project' || params.agentScope === 'both' ? params.agentScope : 'user';
    const { agents } = discoverAgents({ cwd, userDir, builtinDir: agentsDir, scope });
    const available = formatAgentList(agents);

    const chain = Array.isArray(params.chain) ? params.chain : [];
    const tasks = Array.isArray(params.tasks) ? params.tasks : [];
    const single = Boolean(params.agent && params.task);
    const modes = Number(chain.length > 0) + Number(tasks.length > 0) + Number(single);
    if (modes !== 1) {
      return { content: [{ type: 'text', text: `Укажите ровно один режим: agent + task, tasks или chain.\nДоступные агенты: ${available}` }] };
    }
    if (tasks.length > MAX_PARALLEL_TASKS) {
      return { content: [{ type: 'text', text: `Слишком много параллельных задач (${tasks.length}). Максимум ${MAX_PARALLEL_TASKS}.` }] };
    }

    const findAgent = (name) => agents.find((agent) => agent.name === name);
    const unknown = (name) => ({ content: [{ type: 'text', text: `Неизвестный агент: «${name}». Доступно: ${available}` }] });

    if (chain.length) {
      const group = randomUUID().slice(0, 8);
      const results = [];
      let previous = '';
      for (let index = 0; index < chain.length; index += 1) {
        const step = chain[index];
        const agent = findAgent(step.agent);
        if (!agent) return unknown(step.agent);
        const task = String(step.task || '').replace(/\{previous\}/g, previous);
        const result = await runChild(agent, task, { cwd, inheritedModel: model, thinkingLevel, signal, group, step: index + 1, progress: () => notify(onUpdate, 'chain') });
        results.push(result);
        notify(onUpdate, 'chain');
        if (result.status !== 'done') {
          return {
            content: [{ type: 'text', text: `Цепочка остановлена на шаге ${index + 1} (${step.agent}): ${currentText(result)}` }],
            details: { mode: 'chain', subagents: snapshot() },
          };
        }
        previous = result.output || '';
      }
      return {
        content: [{ type: 'text', text: results.at(-1)?.output || '(нет вывода)' }],
        details: { mode: 'chain', subagents: snapshot() },
      };
    }

    if (tasks.length) {
      const group = randomUUID().slice(0, 8);
      for (const task of tasks) if (!findAgent(task.agent)) return unknown(task.agent);
      const results = await mapWithConcurrency(tasks, MAX_CONCURRENCY, async (task, index) => {
        const agent = findAgent(task.agent);
        const result = await runChild(agent, String(task.task || ''), {
          cwd,
          inheritedModel: model,
          thinkingLevel,
          signal,
          group,
          step: index + 1,
          progress: () => notify(onUpdate, 'parallel'),
        });
        notify(onUpdate, 'parallel');
        return result;
      });
      const succeeded = results.filter((result) => result.status === 'done').length;
      const summary = results
        .map((result) => {
          const output = result.status === 'done' ? result.output : currentText(result);
          return `### [${result.agent}] ${result.status === 'done' ? 'готово' : 'ошибка'}\n\n${capBytes(output, outputCap)}`;
        })
        .join('\n\n---\n\n');
      return {
        content: [{ type: 'text', text: `Параллельно: ${succeeded}/${results.length} успешно\n\n${summary}` }],
        details: { mode: 'parallel', subagents: snapshot() },
      };
    }

    const agent = findAgent(params.agent);
    if (!agent) return unknown(params.agent);
    const result = await runChild(agent, String(params.task || ''), {
      cwd,
      inheritedModel: model,
      thinkingLevel,
      signal,
      group: undefined,
      step: undefined,
      progress: () => notify(onUpdate, 'single'),
    });
    notify(onUpdate, 'single');
    if (result.status !== 'done') {
      return {
        content: [{ type: 'text', text: `Агент ${agent.name} не справился: ${currentText(result)}` }],
        details: { mode: 'single', subagents: snapshot() },
      };
    }
    return {
      content: [{ type: 'text', text: result.output || '(нет вывода)' }],
      details: { mode: 'single', subagents: snapshot() },
    };
  }

  function dispose() {
    clearTimeout(emitTimer);
    clearInterval(heartbeat);
    heartbeat = undefined;
    for (const { stop } of runtime.values()) {
      try {
        stop();
      } catch {}
    }
    runtime.clear();
  }

  return { run, snapshot, dispose, discover: discoverAgents };
}

/* ============================== pi registration ============================== */

export function installSubagents(pi, { Type, cli, builtinDir = BUILTIN_AGENTS_DIR, userDir, emit, env = process.env, spawnProcess = spawn } = {}) {
  const service = createSubagentService({ cli, emit, env, spawnProcess, builtinDir });
  pi.registerTool({
    name: 'subagent',
    label: 'Субагент',
    description: [
      'Delegate a task to an isolated subagent process with its own context window.',
      'Modes: single (agent + task), parallel (tasks array), chain (sequential steps with {previous} placeholder).',
      'Default agents: scout (fast code recon), planner (implementation plan), worker (full capabilities), reviewer (code review).',
      'Use for research, planning, parallel exploration or review. The final answer and live progress stay visible in the web panel.',
    ].join(' '),
    parameters: Type.Object({
      agent: Type.Optional(Type.String({ description: 'Agent name for single mode: scout, planner, worker or reviewer' })),
      task: Type.Optional(Type.String({ description: 'Task for the agent (single mode)' })),
      tasks: Type.Optional(
        Type.Array(
          Type.Object({
            agent: Type.String({ description: 'Agent name' }),
            task: Type.String({ description: 'Task for this agent' }),
          }),
          { description: 'Parallel tasks, up to 8 (4 run at once)' },
        ),
      ),
      chain: Type.Optional(
        Type.Array(
          Type.Object({
            agent: Type.String({ description: 'Agent name' }),
            task: Type.String({ description: 'Task with optional {previous} placeholder for the previous output' }),
          }),
          { description: 'Sequential steps; each step may use {previous}' },
        ),
      ),
      agentScope: Type.Optional(
        Type.String({ enum: ['user', 'project', 'both'], description: 'Agent directories: built-in + user (default), project, or both' }),
      ),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      try {
        return await service.run(params, {
          cwd: ctx.cwd,
          model: ctx.model,
          thinkingLevel: ctx.thinkingLevel,
          signal,
          onUpdate,
          userDir,
          builtinDir,
        });
      } catch (error) {
        return { content: [{ type: 'text', text: `Субагент не запустился: ${error.message}` }] };
      }
    },
  });
  return service;
}

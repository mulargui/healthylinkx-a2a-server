import crypto from 'crypto';
import http from 'node:http';
import { z } from 'zod';

import { AGENT_CARD_PATH } from '@a2a-js/sdk';
import { DefaultRequestHandler, InMemoryTaskStore } from '@a2a-js/sdk/server';
import { A2AError } from '@a2a-js/sdk/server';

import { SearchDoctors } from './healthylinkx.js';

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

function getRequestId(event, context) {
  return (
    context?.awsRequestId ||
    event?.requestContext?.requestId ||
    headerValue(event?.headers, 'x-request-id') ||
    headerValue(event?.headers, 'x-amzn-requestid') ||
    headerValue(event?.headers, 'x-amz-request-id') ||
    newId('req')
  );
}

function getLogLevel() {
  const level = (process.env.LOG_LEVEL || 'info').toLowerCase();
  if (['debug', 'info', 'warn', 'error'].includes(level)) return level;
  return 'info';
}

function shouldLog(level) {
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  return order[level] >= order[getLogLevel()];
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const allow = new Set([
    'host',
    'user-agent',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-forwarded-host',
    'x-amzn-trace-id',
    'x-request-id',
    'x-amz-request-id'
  ]);

  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (!allow.has(key)) continue;
    out[key] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

function logLine(level, message, fields = {}) {
  if (!shouldLog(level)) return;
  const payload = {
    level,
    ts: nowIso(),
    msg: message,
    ...fields
  };

  if (level === 'error') console.error(JSON.stringify(payload));
  else if (level === 'warn') console.warn(JSON.stringify(payload));
  else console.log(JSON.stringify(payload));
}

function eventSummary(event) {
  const method = getMethod(event);
  const path = getPath(event);
  const query = getQueryParams(event);
  const contentType = headerValue(event?.headers, 'content-type');
  const body = decodeBody(event);

  return {
    method,
    path,
    query,
    contentType,
    isBase64Encoded: Boolean(event?.isBase64Encoded),
    headers: sanitizeHeaders(event?.headers),
    bodyBytes: typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : 0
  };
}

function getMethod(event) {
  return (
    event?.requestContext?.http?.method ||
    event?.httpMethod ||
    'GET'
  ).toUpperCase();
}

function getPath(event) {
  return event?.rawPath || event?.path || '/';
}

function getQueryParams(event) {
  if (event?.queryStringParameters && typeof event.queryStringParameters === 'object') {
    return event.queryStringParameters;
  }
  if (typeof event?.rawQueryString === 'string' && event.rawQueryString.length > 0) {
    return Object.fromEntries(new URLSearchParams(event.rawQueryString));
  }
  return {};
}

function decodeBody(event) {
  if (event?.body == null) return undefined;
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8');
  }
  return String(event.body);
}

function jsonResponse(statusCode, bodyObj, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      ...extraHeaders
    },
    body: JSON.stringify(bodyObj)
  };
}

function emptyResponse(statusCode, extraHeaders = {}) {
  return {
    statusCode,
    headers: { ...extraHeaders },
    body: ''
  };
}

function a2aErrorToHttpStatus(code) {
  switch (code) {
    case -32700: // parse error
    case -32600: // invalid request
    case -32602: // invalid params
      return 400;
    case -32601: // method not found
      return 404;
    case -32001: // task not found
      return 404;
    case -32002: // task not cancelable
      return 409;
    case -32004: // unsupported operation
      return 400;
    default:
      return 500;
  }
}

function errorResponse(err) {
  if (err instanceof A2AError) {
    return jsonResponse(a2aErrorToHttpStatus(err.code), {
      code: err.code,
      message: err.message,
      ...(err.data ? { data: err.data } : {})
    });
  }
  return jsonResponse(500, {
    code: -32603,
    message: err instanceof Error ? err.message : 'Internal error'
  });
}

function getConfiguredPublicBaseUrl() {
  const configured = process.env.A2A_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL;
  if (configured && typeof configured === 'string') return configured.replace(/\/+$/, '');
  return undefined;
}

function getPublicBaseUrlFromEvent(event) {
  const configured = getConfiguredPublicBaseUrl();
  if (configured) return configured;

  const host = headerValue(event?.headers, 'host') || event?.requestContext?.domainName;
  const proto = (headerValue(event?.headers, 'x-forwarded-proto') || 'https').toString();
  if (host) return `${proto}://${host}`;
  return 'http://localhost:3000';
}

const SearchDoctorsArgsSchema = z.object({
  zipcode: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v),
    z.number().int().gte(10000).lte(99999)
  ),
  lastname: z.string().min(1),
  specialty: z.string().min(1).optional(),
  gender: z.enum(['male', 'female']).optional()
});

function extractTextFromParts(parts) {
  if (!Array.isArray(parts)) return undefined;
  const textPart = parts.find((p) => p && typeof p === 'object' && p.kind === 'text' && typeof p.text === 'string');
  return textPart?.text;
}

function parseSearchArgs({ requestMetadata, messageMetadata, parts }) {
  if (requestMetadata && typeof requestMetadata === 'object' && requestMetadata.searchDoctors && typeof requestMetadata.searchDoctors === 'object') {
    const parsed = SearchDoctorsArgsSchema.safeParse(requestMetadata.searchDoctors);
    if (parsed.success) return parsed.data;
  }

  if (messageMetadata && typeof messageMetadata === 'object' && messageMetadata.searchDoctors && typeof messageMetadata.searchDoctors === 'object') {
    const parsed = SearchDoctorsArgsSchema.safeParse(messageMetadata.searchDoctors);
    if (parsed.success) return parsed.data;
  }

  const text = extractTextFromParts(parts);
  if (typeof text === 'string' && text.trim().startsWith('{')) {
    try {
      const obj = JSON.parse(text);
      const parsed = SearchDoctorsArgsSchema.safeParse(obj);
      if (parsed.success) return parsed.data;
    } catch {
      // fall through
    }
  }

  if (typeof text === 'string') {
    const tokens = Object.fromEntries(
      text
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => t.split('='))
        .filter((pair) => pair.length === 2)
        .map(([k, v]) => [k, v])
    );

    const maybe = {
      zipcode: tokens.zipcode,
      lastname: tokens.lastname,
      specialty: tokens.specialty,
      gender: tokens.gender
    };

    const parsed = SearchDoctorsArgsSchema.safeParse(maybe);
    if (parsed.success) return parsed.data;
  }

  return null;
}

class HealthylinkxExecutor {
  async execute(requestContext, eventBus) {
    const { taskId, contextId, userMessage, task } = requestContext;

    const args = parseSearchArgs({
      requestMetadata: requestContext?.metadata,
      messageMetadata: userMessage?.metadata,
      parts: userMessage?.parts
    });

    if (!args) {
      eventBus.publish({
        kind: 'status-update',
        taskId,
        contextId,
        status: {
          state: 'failed',
          timestamp: nowIso()
        },
        final: true
      });
      eventBus.finished();
      return;
    }

    if (!task) {
      eventBus.publish({
        kind: 'task',
        id: taskId,
        contextId,
        status: {
          state: 'submitted',
          timestamp: nowIso()
        },
        history: userMessage ? [userMessage] : []
      });
    }

    eventBus.publish({
      kind: 'status-update',
      taskId,
      contextId,
      status: {
        state: 'working',
        timestamp: nowIso()
      },
      final: false
    });

    const search = await SearchDoctors(args.gender, args.lastname, args.specialty, args.zipcode);
    if (search.statusCode !== 200) {
      eventBus.publish({
        kind: 'status-update',
        taskId,
        contextId,
        status: {
          state: 'failed',
          timestamp: nowIso()
        },
        final: true
      });
      eventBus.finished();
      return;
    }

    const results = Array.isArray(search.result)
      ? search.result.map((row) => ({
          name: row.Provider_Full_Name,
          address: row.Provider_Full_Street,
          city: row.Provider_Full_City,
          classification: row.Classification
        }))
      : [];

    eventBus.publish({
      kind: 'artifact-update',
      taskId,
      contextId,
      artifact: {
        artifactId: newId('artifact'),
        name: 'SearchResults',
        parts: [{ kind: 'text', text: JSON.stringify({ searchResults: results }) }]
      }
    });

    eventBus.publish({
      kind: 'status-update',
      taskId,
      contextId,
      status: {
        state: 'completed',
        timestamp: nowIso()
      },
      final: true
    });
    eventBus.finished();
  }

  cancelTask = async () => {};
}

const port = parseInt(process.env.PORT || '3000');
const publicBaseUrlForCard = getConfiguredPublicBaseUrl() || `http://localhost:${port}`;

const agentCard = {
  name: 'Healthylinkx A2A Server',
  description: 'A2A interface to Healthylinkx functionality. Provides doctor search via A2A SendMessage.',
  protocolVersion: '0.3.0',
  version: '1.0.0',
  url: `${publicBaseUrlForCard}/a2a/rest`,
  preferredTransport: 'HTTP+JSON',
  skills: [
    {
      id: 'search-doctors',
      name: 'Search Doctors',
      description: 'Search for doctors in the HealthyLinkx directory (zipcode, lastname, optional specialty and gender).',
      tags: ['health', 'doctors', 'search', 'directory']
    }
  ],
  capabilities: {
    streaming: false,
    pushNotifications: false
  },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  additionalInterfaces: [{ url: `${publicBaseUrlForCard}/a2a/rest`, transport: 'HTTP+JSON' }]
};

const requestHandler = new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), new HealthylinkxExecutor());

function normalizeSendMessageBody(body) {
  const oldMessage = body?.message;
  const oldRole = oldMessage?.role;
  const looksLegacy = typeof oldRole === 'string' && oldRole.startsWith('ROLE_');
  const parts = oldMessage?.parts;
  const hasLegacyParts = Array.isArray(parts) && parts.some((p) => p && typeof p === 'object' && 'text' in p && !('kind' in p));

  if (looksLegacy || hasLegacyParts) {
    const role = oldRole === 'ROLE_AGENT' ? 'agent' : 'user';
    const newParts = Array.isArray(parts)
      ? parts.map((p) => ({ kind: 'text', text: typeof p?.text === 'string' ? p.text : '' }))
      : [{ kind: 'text', text: '' }];

    return {
      ...body,
      message: {
        kind: 'message',
        ...oldMessage,
        messageId: oldMessage?.messageId || newId('msg'),
        role,
        parts: newParts
      }
    };
  }

  // Non-legacy: ensure required fields exist.
  if (body?.message && typeof body.message === 'object') {
    return {
      ...body,
      message: {
        kind: 'message',
        ...body.message,
        messageId: body.message.messageId || newId('msg')
      }
    };
  }
  return body;
}

async function handleRest(event, { requestId } = {}) {
  const method = getMethod(event);
  const path = getPath(event);
  const query = getQueryParams(event);

  // Agent card
  if (method === 'GET' && (path === `/${AGENT_CARD_PATH}` || path === '/a2a/rest/v1/card' || path === '/v1/card')) {
    logLine('info', 'route', { requestId, route: 'agent-card', method, path });
    // If no A2A_PUBLIC_BASE_URL is set, we at least make the card self-consistent for this request.
    const base = getPublicBaseUrlFromEvent(event);
    const dynamicCard = {
      ...agentCard,
      url: `${base}/a2a/rest`,
      additionalInterfaces: [{ url: `${base}/a2a/rest`, transport: 'HTTP+JSON' }]
    };
    return jsonResponse(200, dynamicCard, { 'content-type': 'application/a2a+json' });
  }

  // Send message
  if (method === 'POST' && (path === '/a2a/rest/v1/message:send' || path === '/v1/message:send' || path === '/message:send')) {
    logLine('info', 'route', { requestId, route: 'message:send', method, path });
    const bodyText = decodeBody(event);
    if (!bodyText) {
      logLine('warn', 'missing body', { requestId, method, path });
      return jsonResponse(400, { code: -32602, message: 'Missing request body' });
    }

    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      logLine('warn', 'invalid json', {
        requestId,
        method,
        path,
        ...(shouldLog('debug') ? { bodyPreview: bodyText.slice(0, 1024) } : {})
      });
      throw A2AError.parseError('Invalid JSON');
    }

    const params = normalizeSendMessageBody(body);
    const result = await requestHandler.sendMessage(params);
    return jsonResponse(200, result, { 'content-type': 'application/a2a+json' });
  }

  // Streaming not supported for Lambda native HTTP responses (SSE).
  if (method === 'POST' && (path === '/a2a/rest/v1/message:stream' || path === '/v1/message:stream' || path === '/message:stream')) {
    logLine('info', 'route', { requestId, route: 'message:stream (unsupported)', method, path });
    return jsonResponse(400, { code: -32004, message: 'Unsupported operation: message:stream' }, { 'content-type': 'application/a2a+json' });
  }

  // Task: get
  const taskGetMatch = path.match(/^\/a2a\/rest\/v1\/tasks\/(.+)$/) || path.match(/^\/v1\/tasks\/(.+)$/) || path.match(/^\/tasks\/(.+)$/);
  if (method === 'GET' && taskGetMatch) {
    logLine('info', 'route', { requestId, route: 'tasks:get', method, path });
    const id = decodeURIComponent(taskGetMatch[1]);
    const historyLength = query.historyLength != null ? Number(query.historyLength) : undefined;
    const task = await requestHandler.getTask({ id, historyLength });
    return jsonResponse(200, task, { 'content-type': 'application/a2a+json' });
  }

  // Task: cancel
  const cancelMatch = path.match(/^\/a2a\/rest\/v1\/tasks\/(.+):cancel$/) || path.match(/^\/v1\/tasks\/(.+):cancel$/) || path.match(/^\/tasks\/(.+):cancel$/);
  if (method === 'POST' && cancelMatch) {
    logLine('info', 'route', { requestId, route: 'tasks:cancel', method, path });
    const id = decodeURIComponent(cancelMatch[1]);
    const task = await requestHandler.cancelTask({ id });
    return jsonResponse(200, task, { 'content-type': 'application/a2a+json' });
  }

  // Task: subscribe/resubscribe (streaming) not supported
  const subscribeMatch = path.match(/^\/a2a\/rest\/v1\/tasks\/(.+):subscribe$/) || path.match(/^\/v1\/tasks\/(.+):subscribe$/) || path.match(/^\/tasks\/(.+):subscribe$/);
  if (method === 'POST' && subscribeMatch) {
    logLine('info', 'route', { requestId, route: 'tasks:subscribe (unsupported)', method, path });
    return jsonResponse(400, { code: -32004, message: 'Unsupported operation: tasks:subscribe' }, { 'content-type': 'application/a2a+json' });
  }

  if (method === 'OPTIONS') {
    logLine('debug', 'route', { requestId, route: 'options', method, path });
    // Basic CORS preflight for Function URLs / API Gateway.
    return emptyResponse(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': '*',
      'access-control-allow-headers': '*'
    });
  }

  logLine('warn', 'route not found', { requestId, method, path });
  return jsonResponse(404, { code: -32601, message: `Not found: ${method} ${path}` });
}

export async function handler(event, context) {
  const requestId = getRequestId(event, context);
  const started = Date.now();
  logLine('info', 'request start', { requestId, ...eventSummary(event) });
  try {
    const resp = await handleRest(event, { requestId });
    // Always allow cross-origin usage since Function URLs are often used directly.
    resp.headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      ...resp.headers
    };
    logLine('info', 'request end', {
      requestId,
      statusCode: resp.statusCode,
      durationMs: Date.now() - started
    });
    return resp;
  } catch (err) {
    logLine('error', 'request failed', {
      requestId,
      durationMs: Date.now() - started,
      errorName: err?.name,
      errorMessage: err instanceof Error ? err.message : String(err),
      ...(err instanceof Error && err.stack ? { stack: err.stack.split('\n').slice(0, 20).join('\n') } : {}),
      ...eventSummary(event),
      ...(shouldLog('debug') ? { bodyPreview: (decodeBody(event) || '').slice(0, 1024) } : {})
    });
    const resp = errorResponse(err);
    resp.headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      ...resp.headers
    };
    logLine('info', 'request end', {
      requestId,
      statusCode: resp.statusCode,
      durationMs: Date.now() - started
    });
    return resp;
  }
}

// Optional local HTTP runner (no Express). Enabled via RUN_LOCAL_HTTP=1.
if (process.env.RUN_LOCAL_HTTP === '1') {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const event = {
        version: '2.0',
        rawPath: url.pathname,
        rawQueryString: url.searchParams.toString(),
        headers: req.headers,
        requestContext: { http: { method: req.method || 'GET' } },
        body,
        isBase64Encoded: false
      };

      const out = await handler(event);
      res.statusCode = out.statusCode || 200;
      for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
      res.end(out.body || '');
    });
  });

  server.listen(port, () => {
    console.log(`Healthylinkx A2A Lambda-native HTTP shim listening on ${port}`);
  });
}

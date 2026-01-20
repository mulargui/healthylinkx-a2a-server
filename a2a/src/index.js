/**
 * Lambda handler for A2A Agent
 * Uses SDK components with Lambda-specific adapter
 * @module index
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LambdaA2AAdapter } from './lambdaAdapter.js';
import { DoctorSearchExecutor } from './DoctorSearchExecutor.js';
import { createAgentCard } from './agentCard.js';

// Read config
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath));

// Singleton adapter (initialized once per Lambda container)
let adapter = null;

/**
 * Get or create the A2A adapter (singleton pattern for Lambda warm starts)
 * @param {string} baseUrl - The base URL for the agent
 * @returns {LambdaA2AAdapter} The adapter instance
 */
function getAdapter(baseUrl) {
  if (!adapter) {
    console.log('[getAdapter] Initializing adapter with baseUrl:', baseUrl);
    const agentCard = createAgentCard(baseUrl, config);
    const executor = new DoctorSearchExecutor();
    adapter = new LambdaA2AAdapter(agentCard, executor);
  }
  return adapter;
}

/**
 * Derive the base URL from the Lambda event
 * @param {object} event - Lambda event object
 * @returns {string} Base URL
 */
function getBaseUrl(event) {
  const host = event.headers?.host || event.requestContext?.domainName;
  const protocol = event.headers?.['x-forwarded-proto'] || 'https';
  return `${protocol}://${host}`;
}

/**
 * Create a JSON response
 * @param {number} statusCode - HTTP status code
 * @param {object} body - Response body
 * @returns {object} Lambda response object
 */
function createResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

/**
 * Create a redirect response
 * @param {string} location - Redirect URL
 * @returns {object} Lambda response object
 */
function createRedirect(location) {
  return {
    statusCode: 302,
    headers: {
      'Location': location
    },
    body: ''
  };
}

/**
 * Handle GET /health - Health check endpoint
 * @returns {object} Lambda response with health status
 */
function handleHealthCheck() {
  return createResponse(200, {
    status: 'healthy',
    service: 'a2a-agent',
    name: config.a2a.agentName,
    version: config.a2a.agentVersion
  });
}

/**
 * Main Lambda handler
 * Routes requests to appropriate handlers using SDK components
 * @param {object} event - Lambda Function URL event
 * @param {object} context - Lambda context
 * @returns {Promise<object>} Lambda response
 */
export async function handler(event, context) {
  const path = event.rawPath || '/';
  const method = event.requestContext?.http?.method || 'GET';

  console.log(`[handler] Incoming request: ${method} ${path}`);

  const baseUrl = getBaseUrl(event);
  const a2aAdapter = getAdapter(baseUrl);

  // Route: GET /.well-known/agent-card.json
  if (method === 'GET' && path === '/.well-known/agent-card.json') {
    console.log('[handler] Routing to agent card');
    return createResponse(200, a2aAdapter.getAgentCard());
  }

  // Route: POST /a2a - A2A JSON-RPC endpoint
  if (method === 'POST' && path === '/a2a') {
    console.log('[handler] Routing to JSON-RPC handler');
    return await a2aAdapter.handleJsonRpc(event);
  }

  // Route: GET /health - Health check
  if (method === 'GET' && path === '/health') {
    console.log('[handler] Routing to health check');
    return handleHealthCheck();
  }

  // Route: GET / - Redirect to agent card
  if (method === 'GET' && path === '/') {
    console.log('[handler] Routing to redirect');
    return createRedirect('/.well-known/agent-card.json');
  }

  // 404 Not Found
  console.error(`[handler] 404 Not Found: ${method} ${path}`);
  return createResponse(404, {
    error: 'Not Found',
    path: path,
    method: method,
    availableRoutes: [
      'GET /.well-known/agent-card.json',
      'POST /a2a',
      'GET /health',
      'GET /'
    ]
  });
}

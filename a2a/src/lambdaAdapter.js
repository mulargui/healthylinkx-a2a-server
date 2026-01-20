/**
 * Lambda adapter for A2A protocol handling
 * Bridges Lambda Function URL events to A2A SDK components
 * @module lambdaAdapter
 */

/**
 * JSON-RPC 2.0 error codes
 */
const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVER_ERROR: -32000
};

/**
 * LambdaA2AAdapter bridges Lambda events to A2A SDK components
 * Handles JSON-RPC routing and protocol validation
 */
export class LambdaA2AAdapter {
  /**
   * Create a new Lambda A2A adapter
   * @param {object} agentCard - The agent card definition
   * @param {object} executor - AgentExecutor implementation
   */
  constructor(agentCard, executor) {
    this.agentCard = agentCard;
    this.executor = executor;
    this.tasks = new Map(); // In-memory task storage (per Lambda invocation)
  }

  /**
   * Get the agent card
   * @returns {object} The agent card
   */
  getAgentCard() {
    return this.agentCard;
  }

  /**
   * Handle a JSON-RPC request from Lambda
   * @param {object} event - Lambda event object
   * @returns {Promise<object>} Lambda response with JSON-RPC result
   */
  async handleJsonRpc(event) {
    // Parse request body
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return this.createJsonRpcErrorResponse(
        null,
        ErrorCodes.PARSE_ERROR,
        'Parse error: Invalid JSON'
      );
    }

    console.log('[LambdaA2AAdapter] Incoming JSON-RPC request:', JSON.stringify(body));

    const { jsonrpc, method, params, id } = body;

    // Validate JSON-RPC 2.0 format
    if (jsonrpc !== '2.0') {
      return this.createJsonRpcErrorResponse(
        id || null,
        ErrorCodes.INVALID_REQUEST,
        'Invalid Request: jsonrpc must be "2.0"'
      );
    }

    // Route to method handler
    try {
      switch (method) {
        case 'message/send':
          return await this.handleMessageSend(params, id);

        case 'tasks/get':
          return this.handleTasksGet(params, id);

        case 'tasks/cancel':
          return this.handleTasksCancel(params, id);

        default:
          return this.createJsonRpcErrorResponse(
            id,
            ErrorCodes.METHOD_NOT_FOUND,
            `Method not found: ${method}. Supported methods: message/send, tasks/get, tasks/cancel`
          );
      }
    } catch (error) {
      console.error('[LambdaA2AAdapter] Error handling method:', error.message);
      return this.createJsonRpcErrorResponse(
        id,
        ErrorCodes.INTERNAL_ERROR,
        'Internal server error'
      );
    }
  }

  /**
   * Handle message/send method - execute a new task
   * @param {object} params - Request parameters with message
   * @param {string|number} id - JSON-RPC request ID
   * @returns {Promise<object>} Lambda response with task result
   */
  async handleMessageSend(params, id) {
    console.log('[LambdaA2AAdapter] Handling message/send');

    if (!params || !params.message) {
      return this.createJsonRpcErrorResponse(
        id,
        ErrorCodes.INVALID_PARAMS,
        'Invalid params: message is required'
      );
    }

    // Generate task and context IDs
    const taskId = params.id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const contextId = params.contextId || `ctx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create initial task object
    const task = {
      id: taskId,
      contextId: contextId,
      status: { state: 'submitted' },
      history: []
    };

    // Build request context for executor
    const requestContext = {
      userMessage: params.message,
      task: task,
      contextId: contextId
    };

    // Simple event bus for status updates (logging only for now)
    const eventBus = {
      publish: (event) => {
        console.log('[LambdaA2AAdapter] Event published:', JSON.stringify(event));
      }
    };

    // Execute the task
    console.log('[LambdaA2AAdapter] Executing task:', taskId);
    const result = await this.executor.execute(requestContext, eventBus);

    // Store task result (for potential tasks/get calls within same invocation)
    this.tasks.set(taskId, result);

    // Check if executor returned an error state
    if (result.status && result.status.state === 'failed') {
      // Return the task with failed status (not a JSON-RPC error)
      return this.createJsonRpcSuccessResponse(id, result);
    }

    console.log('[LambdaA2AAdapter] Task completed successfully');
    return this.createJsonRpcSuccessResponse(id, result);
  }

  /**
   * Handle tasks/get method - retrieve task status
   * @param {object} params - Request parameters with task ID
   * @param {string|number} id - JSON-RPC request ID
   * @returns {object} Lambda response with task or error
   */
  handleTasksGet(params, id) {
    console.log('[LambdaA2AAdapter] Handling tasks/get');

    if (!params || !params.id) {
      return this.createJsonRpcErrorResponse(
        id,
        ErrorCodes.INVALID_PARAMS,
        'Invalid params: id is required'
      );
    }

    const task = this.tasks.get(params.id);

    if (!task) {
      return this.createJsonRpcErrorResponse(
        id,
        ErrorCodes.SERVER_ERROR,
        `Task not found: ${params.id}. Note: Tasks are only stored within a single Lambda invocation.`
      );
    }

    return this.createJsonRpcSuccessResponse(id, task);
  }

  /**
   * Handle tasks/cancel method - cancel a running task
   * @param {object} params - Request parameters with task ID
   * @param {string|number} id - JSON-RPC request ID
   * @returns {object} Lambda response with cancelled task or error
   */
  handleTasksCancel(params, id) {
    console.log('[LambdaA2AAdapter] Handling tasks/cancel');

    if (!params || !params.id) {
      return this.createJsonRpcErrorResponse(
        id,
        ErrorCodes.INVALID_PARAMS,
        'Invalid params: id is required'
      );
    }

    const task = this.tasks.get(params.id);

    if (!task) {
      return this.createJsonRpcErrorResponse(
        id,
        ErrorCodes.SERVER_ERROR,
        `Task not found: ${params.id}. Note: Tasks are only stored within a single Lambda invocation.`
      );
    }

    // Mark task as cancelled
    task.status = { state: 'canceled' };
    this.tasks.set(params.id, task);

    return this.createJsonRpcSuccessResponse(id, task);
  }

  /**
   * Create a successful JSON-RPC response
   * @param {string|number} id - Request ID
   * @param {object} result - Result object
   * @returns {object} Lambda response object
   */
  createJsonRpcSuccessResponse(id, result) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        result: result,
        id: id
      })
    };
  }

  /**
   * Create a JSON-RPC error response
   * @param {string|number|null} id - Request ID
   * @param {number} code - Error code
   * @param {string} message - Error message
   * @param {*} data - Optional error data
   * @returns {object} Lambda response object
   */
  createJsonRpcErrorResponse(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) {
      error.data = data;
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        error: error,
        id: id
      })
    };
  }
}

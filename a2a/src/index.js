import { 
    DefaultRequestHandler,
    InMemoryTaskStore,
    JsonRpcTransportHandler,
    ServerCallContext,
    UnauthenticatedUser,
    A2AError
} from '@a2a-js/sdk/server';

// healthylinkx extension
import { SearchDoctors } from './healthylinkx.js';

class HealthylinkxExecutor {
    parseNaturalLanguage(text) {
        const input = {};
        
        // Match Zipcode (5 digits)
        const zipMatch = text.match(/\b(\d{5})\b/);
        if (zipMatch) input.zipcode = parseInt(zipMatch[1]);
        
        // Match Lastname (named XXX or name XXX)
        const nameMatch = text.match(/(?:named|name)\s+([a-zA-Z]+)/i);
        if (nameMatch) input.lastname = nameMatch[1];
        
        // Match Specialty (specializing in XXX, specialty XXX, or specialized in XXX)
        const specialtyMatch = text.match(/(?:specializing in|specialized in|specialty)\s+([a-zA-Z\s]+?)(?:\s+at|\s+named|\s+name|$)/i);
        if (specialtyMatch) input.specialty = specialtyMatch[1].trim();
        
        // Match Gender
        if (/\bmale\b/i.test(text)) input.gender = 'male';
        if (/\bfemale\b/i.test(text)) input.gender = 'female';
        
        return input;
    }

    async execute(requestContext, eventBus) {
        const { task, userMessage, taskId, contextId } = requestContext;
        
        console.log(`[A2A Executor] Processing execution request.`);
        console.log(`[A2A Executor] Task ID: ${taskId}`);
        console.log(`[A2A Executor] Context ID: ${contextId}`);

        // Extract input parameters
        let input = (task && task.metadata && task.metadata.input) ? task.metadata.input : {};
        
        if (Object.keys(input).length === 0 && userMessage && userMessage.parts) {
            console.log(`[A2A Executor] Searching for input in message parts...`);
            
            // Look for a data part
            const dataPart = userMessage.parts.find(p => p.kind === 'data' && p.data);
            if (dataPart) {
                input = dataPart.data;
                console.log(`[A2A Executor] Found input in data part.`);
            } else {
                // Fallback: Check text part for JSON or Natural Language
                const textPart = userMessage.parts.find(p => p.kind === 'text' && p.text);
                if (textPart) {
                    try {
                        const parsed = JSON.parse(textPart.text);
                        if (typeof parsed === 'object') {
                            input = parsed;
                            console.log(`[A2A Executor] Parsed input from text part JSON.`);
                        }
                    } catch (e) {
                        // Not JSON, treat as natural language
                        console.log(`[A2A Executor] Attempting to parse natural language: "${textPart.text}"`);
                        input = this.parseNaturalLanguage(textPart.text);
                    }
                }
            }
        }

        console.log(`[A2A Executor] Final input parameters:`, JSON.stringify(input, null, 2));

        const { zipcode, lastname, specialty, gender } = input;
        
        // Ensure we have at least some parameters to search with
        if (!zipcode && !lastname && !specialty) {
            console.warn(`[A2A Executor] No search parameters found.`);
            eventBus.publish({
                kind: 'message',
                messageId: crypto.randomUUID(),
                taskId: taskId,
                contextId: contextId,
                role: 'agent',
                parts: [{ kind: 'text', text: "I couldn't find any search parameters (zipcode, lastname, or specialty) in your request. Please provide them as a JSON object." }]
            });
            eventBus.publish({
                kind: 'status-update',
                taskId: taskId,
                contextId: contextId,
                status: {
                    state: 'failed',
                    timestamp: new Date().toISOString()
                },
                final: true
            });
            return;
        }

        try {
            console.log(`[A2A Executor] Calling SearchDoctors...`);
            const search = await SearchDoctors(gender, lastname, specialty, zipcode);
            
            if (search.statusCode != 200) {
                console.error(`[A2A Executor] SearchDoctors failed:`, search.result);
                eventBus.publish({
                    kind: 'message',
                    messageId: crypto.randomUUID(),
                    taskId: taskId,
                    contextId: contextId,
                    role: 'agent',
                    parts: [{ kind: 'text', text: `Error: ${search.result}` }]
                });
                eventBus.publish({
                    kind: 'status-update',
                    taskId: taskId,
                    contextId: contextId,
                    status: {
                        state: 'failed',
                        timestamp: new Date().toISOString()
                    },
                    final: true
                });
                return;
            }
            
            console.log(`[A2A Executor] SearchDoctors returned ${search.result.length} results.`);
            const result = search.result.map(row => ({
                Name: row.Provider_Full_Name,
                Address: row.Provider_Full_Street,
                City: row.Provider_Full_City,
                Classification: row.Classification 
            }));

            const output = { SearchResults: result };
            
            console.log(`[A2A Executor] Publishing results.`);
            eventBus.publish({
                kind: 'message',
                messageId: crypto.randomUUID(),
                taskId: taskId,
                contextId: contextId,
                role: 'agent',
                parts: [{ kind: 'text', text: JSON.stringify(output) }]
            });
            
            eventBus.publish({
                kind: 'status-update',
                taskId: taskId,
                contextId: contextId,
                status: {
                    state: 'completed',
                    timestamp: new Date().toISOString()
                },
                final: true
            });
            console.log(`[A2A Executor] Task completed successfully.`);

        } catch (error) {
            console.error('[A2A Executor] Unexpected error:', error);
            eventBus.publish({
                kind: 'message',
                messageId: crypto.randomUUID(),
                taskId: taskId,
                contextId: contextId,
                role: 'agent',
                parts: [{ kind: 'text', text: `Internal Error: ${error.message}` }]
            });
            eventBus.publish({
                kind: 'status-update',
                taskId: taskId,
                contextId: contextId,
                status: {
                    state: 'failed',
                    timestamp: new Date().toISOString()
                },
                final: true
            });
        }
    }
}

const agentCard = {
    name: 'Healthylinkx A2A Agent',
    description: 'Search for doctors in the HealthyLinkx directory',
    protocolVersion: '1.0',
    version: '1.0.0',
    capabilities: {
        streaming: false,
        pushNotifications: false
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [
        {
            id: 'search-doctors',
            name: 'Search Doctors',
            description: 'Search for doctors by zipcode, lastname, specialty, and gender.',
            tags: ['healthcare', 'doctors', 'search'],
            inputModes: ['text'],
            outputModes: ['text']
        }
    ],
    url: 'http://localhost:8080',
    additionalInterfaces: [
        {
            transport: 'a2a/jsonrpc',
            url: 'http://localhost:8080/a2a/jsonrpc'
        }
    ]
};

const executor = new HealthylinkxExecutor();
const taskStore = new InMemoryTaskStore();
const requestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    executor
);
const jsonRpcHandler = new JsonRpcTransportHandler(requestHandler);

/**
 * Lambda Handler
 */
export const handler = async (event) => {
    // Determine the base URL dynamically
    const host = event.headers.host || event.requestContext?.domainName;
    const protocol = event.headers['x-forwarded-proto'] || 'https';
    const baseUrl = `${protocol}://${host}`;

    // Create a dynamic copy of the agent card with correct URLs
    const dynamicAgentCard = {
        ...agentCard,
        url: baseUrl,
        additionalInterfaces: [
            {
                transport: 'a2a/jsonrpc',
                url: `${baseUrl}/a2a/jsonrpc`
            }
        ]
    };

    console.log(`[Lambda] Incoming ${event.requestContext?.http?.method} request to ${event.rawPath}`);
    
    const method = event.requestContext?.http?.method;
    const path = event.rawPath;
    const body = event.body;
    
    // Build A2A context
    const context = new ServerCallContext([], new UnauthenticatedUser());

    try {
        // Route: Agent Card
        if (method === 'GET' && (path === '/.well-known/agent-card.json' || path === '/agent-card')) {
            console.log('[Lambda] Serving Agent Card with base URL:', baseUrl);
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dynamicAgentCard)
            };
        }

        // Route: JSON-RPC (Standard path or Root path)
        if (method === 'POST' && (path === '/a2a/jsonrpc' || path === '/')) {
            console.log(`[Lambda] Handling JSON-RPC request at ${path}`);
            const rpcResponse = await jsonRpcHandler.handle(body, context);
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(rpcResponse)
            };
        }

        // Route: Health
        if (path === '/health') {
            return { statusCode: 200, body: 'OK' };
        }

        console.warn(`[Lambda] 404 Not Found: ${method} ${path}`);
        return {
            statusCode: 404,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Not Found', path })
        };

    } catch (error) {
        console.error('[Lambda] Global Error:', error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                error: 'Internal Server Error', 
                message: error.message,
                code: error.code
            })
        };
    }
};

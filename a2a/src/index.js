import express from 'express';
import { SearchDoctors } from './healthylinkx.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Read config
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath));

// Agent metadata
const AGENT_NAME = config.a2a.agentName;
const AGENT_VERSION = config.a2a.agentVersion;

/**
 * Parse natural language message to extract search parameters
 * @param {string} message - Natural language search query
 * @returns {object} Parsed parameters
 */
function parseSearchMessage(message) {
  const lastnameMatch = message.match(/(?:named?|lastname|last name)\s+(\w+)/i);
  const zipcodeMatch = message.match(/\b(\d{5})\b/);
  const genderMatch = message.match(/\b(male|female)\b/i);
  const specialtyMatch = message.match(/(?:specialty|specialization|type|field)\s+(\w+)/i);

  return {
    lastname: lastnameMatch?.[1],
    zipcode: zipcodeMatch ? parseInt(zipcodeMatch[1]) : undefined,
    gender: genderMatch?.[1]?.toLowerCase(),
    specialty: specialtyMatch?.[1]
  };
}

/**
 * Format doctor search results as human-readable text
 * @param {object} result - Search result with count, doctors, and query
 * @returns {string} Formatted text response
 */
function formatDoctorResults(result) {
  if (result.count === 0) {
    return `No doctors found matching your search criteria.`;
  }

  let text = `Found ${result.count} doctor${result.count > 1 ? 's' : ''} matching your search:\n\n`;

  result.doctors.forEach((doc, index) => {
    text += `${index + 1}. ${doc.name.trim()}\n`;
    text += `   Address: ${doc.address.trim()}, ${doc.city.trim()}\n`;
    text += `   Specialty: ${doc.classification}\n\n`;
  });

  return text.trim();
}

/**
 * Execute doctor search based on message parameters
 * @param {object} params - Search parameters from JSON-RPC request
 * @returns {Promise<object>} Search results or error
 */
async function executeDoctorSearch(params) {
  console.log('[executeDoctorSearch] params:', JSON.stringify(params));

  // Extract text from A2A message structure: params.message.parts[].text
  let message = '';
  if (params.message && params.message.parts && Array.isArray(params.message.parts)) {
    message = params.message.parts
      .filter(part => part.kind === 'text' && part.text)
      .map(part => part.text)
      .join(' ');
  } else if (typeof params.message === 'string') {
    message = params.message;
  }
  console.log('[executeDoctorSearch] extracted message:', message);

  const searchParams = parseSearchMessage(message);
  console.log('[executeDoctorSearch] parsed searchParams:', JSON.stringify(searchParams));

  // Validate required params
  if (!searchParams.zipcode && !searchParams.lastname) {
    console.log('[executeDoctorSearch] missing required params');
    return {
      error: {
        code: -32602,
        message: 'Missing required parameters. Please provide at least zipcode or lastname in your message.'
      }
    };
  }

  // Call SearchDoctors
  console.log('[executeDoctorSearch] calling SearchDoctors with:', {
    gender: searchParams.gender,
    lastname: searchParams.lastname,
    specialty: searchParams.specialty,
    zipcode: searchParams.zipcode
  });
  const result = await SearchDoctors(
    searchParams.gender,
    searchParams.lastname,
    searchParams.specialty,
    searchParams.zipcode
  );
  console.log('[executeDoctorSearch] SearchDoctors result:', JSON.stringify(result));

  // Handle errors
  if (result.statusCode !== 200) {
    console.log('[executeDoctorSearch] SearchDoctors returned error');
    return {
      error: {
        code: -32000,
        message: result.result
      }
    };
  }

  // Format response
  const doctors = result.result.map(row => ({
    name: row.Provider_Full_Name,
    address: row.Provider_Full_Street,
    city: row.Provider_Full_City,
    classification: row.Classification
  }));
  console.log('[executeDoctorSearch] formatted doctors count:', doctors.length);

  return {
    result: {
      count: doctors.length,
      doctors: doctors,
      query: searchParams
    }
  };
}

// Create Express app
const app = express();
app.use(express.json());

// Agent card endpoint (metadata discovery)
app.get('/.well-known/agent.json', (req, res) => {
  // Derive the agent URL from the request
  const protocol = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('host');
  const agentUrl = `${protocol}://${host}/a2a`;

  res.json({
    name: AGENT_NAME,
    version: AGENT_VERSION,
    description: 'Search for doctors in the HealthyLinkx directory using natural language queries',
    url: agentUrl,
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    protocols: ['a2a-v1'],
    skills: [{
      id: 'doctor-search',
      name: 'Doctor Search',
      description: 'Search for doctors by name, zipcode, specialty, or gender',
      tags: ['healthcare', 'doctor', 'search'],
      inputModes: ['text'],
      outputModes: ['text']
    }],
    capabilities: {
      parameters: {
        zipcode: 'number (5-digit US zipcode)',
        lastname: 'string (Doctor\'s last name)',
        specialty: 'string (Medical specialty, optional)',
        gender: 'male or female (optional)'
      },
      exampleQueries: [
        'Find doctors named Smith in 10001',
        'Search for female cardiologist named Johnson in 90210',
        'Find doctors in zipcode 12345'
      ]
    }
  });
});

// A2A JSON-RPC endpoint
app.post('/a2a', async (req, res) => {
  console.log('[/a2a] incoming request body:', JSON.stringify(req.body));
  try {
    const { jsonrpc, method, params, id } = req.body;
    console.log('[/a2a] parsed - jsonrpc:', jsonrpc, 'method:', method, 'id:', id);
    console.log('[/a2a] params:', JSON.stringify(params));

    // Validate JSON-RPC 2.0 format
    if (jsonrpc !== '2.0') {
      console.log('[/a2a] invalid jsonrpc version');
      return res.json({
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Invalid Request: jsonrpc must be "2.0"'
        },
        id: id || null
      });
    }

    // Handle message/send method
    if (method === 'message/send') {
      console.log('[/a2a] handling message/send');
      const searchResult = await executeDoctorSearch(params || {});
      console.log('[/a2a] searchResult:', JSON.stringify(searchResult));

      if (searchResult.error) {
        console.log('[/a2a] returning error response');
        return res.json({
          jsonrpc: '2.0',
          error: searchResult.error,
          id
        });
      }

      console.log('[/a2a] returning success response');

      // Generate unique IDs for task and context
      const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const contextId = `ctx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Format response as A2A Task with proper Message structure
      return res.json({
        jsonrpc: '2.0',
        result: {
          id: taskId,
          contextId: contextId,
          status: { state: 'completed' },
          history: [{
            messageId: messageId,
            role: 'agent',
            parts: [{
              kind: 'text',
              text: formatDoctorResults(searchResult.result)
            }]
          }]
        },
        id
      });
    }

    // Method not found
    console.log('[/a2a] method not found:', method);
    return res.json({
      jsonrpc: '2.0',
      error: {
        code: -32601,
        message: `Method not found: ${method}. Supported methods: message/send`
      },
      id
    });

  } catch (error) {
    console.error('[/a2a] CAUGHT ERROR:', error.message);
    console.error('[/a2a] STACK:', error.stack);
    return res.json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal server error',
        data: config.a2a.debug ? error.message : undefined
      },
      id: req.body.id || null
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'a2a-agent',
    name: AGENT_NAME,
    version: AGENT_VERSION
  });
});

// Root endpoint - redirect to agent card
app.get('/', (req, res) => {
  res.redirect('/.well-known/agent.json');
});

// Listen on port 8080 for Lambda Web Adapter, 3000 locally
const port = process.env.AWS_LAMBDA_FUNCTION_NAME ? 8080 : 3000;
app.listen(port, () => {
  console.log(`A2A Agent Server (${AGENT_NAME}) running on port ${port}`);
  console.log(`Agent card: http://localhost:${port}/.well-known/agent.json`);
  console.log(`A2A endpoint: http://localhost:${port}/a2a`);
}).on('error', error => {
  console.error('A2A Server error:', error);
  process.exit(1);
});

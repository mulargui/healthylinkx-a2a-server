/**
 * AgentExecutor implementation for doctor search functionality
 * Wraps existing doctor search logic to conform to A2A SDK patterns
 * @module DoctorSearchExecutor
 */

import { SearchDoctors } from './healthylinkx.js';

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
    return 'No doctors found matching your search criteria.';
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
 * DoctorSearchExecutor implements the AgentExecutor interface from @a2a-js/sdk
 * Handles doctor search requests and returns formatted results
 */
export class DoctorSearchExecutor {
  /**
   * Execute a doctor search based on the user message
   * @param {object} requestContext - A2A request context containing userMessage
   * @param {object} eventBus - Event bus for publishing task status updates
   * @returns {Promise<object>} Task result with status and response message
   */
  async execute(requestContext, eventBus) {
    const { userMessage, task } = requestContext;

    console.log('[DoctorSearchExecutor] Starting execution for task:', task.id);

    // Publish working status
    if (eventBus) {
      eventBus.publish({
        type: 'task-status',
        taskId: task.id,
        status: { state: 'working' }
      });
    }

    try {
      // Extract text from userMessage.parts
      const messageText = this.extractMessageText(userMessage);
      console.log('[DoctorSearchExecutor] Extracted message text:', messageText);

      // Parse search parameters
      const searchParams = parseSearchMessage(messageText);
      console.log('[DoctorSearchExecutor] Parsed search params:', JSON.stringify(searchParams));

      // Validate required params
      if (!searchParams.zipcode && !searchParams.lastname) {
        console.log('[DoctorSearchExecutor] Missing required params');
        return this.createErrorResult(
          task,
          'Missing required parameters. Please provide at least zipcode or lastname in your message.'
        );
      }

      // Execute search
      console.log('[DoctorSearchExecutor] Calling SearchDoctors');
      const result = await SearchDoctors(
        searchParams.gender,
        searchParams.lastname,
        searchParams.specialty,
        searchParams.zipcode
      );
      console.log('[DoctorSearchExecutor] SearchDoctors returned:', result.statusCode);

      // Handle errors from SearchDoctors
      if (result.statusCode !== 200) {
        console.log('[DoctorSearchExecutor] SearchDoctors returned error');
        return this.createErrorResult(task, result.result);
      }

      // Format successful response
      const doctors = result.result.map(row => ({
        name: row.Provider_Full_Name,
        address: row.Provider_Full_Street,
        city: row.Provider_Full_City,
        classification: row.Classification
      }));

      const formattedText = formatDoctorResults({
        count: doctors.length,
        doctors: doctors,
        query: searchParams
      });

      console.log('[DoctorSearchExecutor] Returning success with', doctors.length, 'doctors');

      return this.createSuccessResult(task, formattedText);

    } catch (error) {
      console.error('[DoctorSearchExecutor] Error during execution:', error.message);
      return this.createErrorResult(task, 'Internal error during doctor search');
    }
  }

  /**
   * Extract text content from a user message's parts array
   * @param {object} userMessage - A2A Message object with parts array
   * @returns {string} Combined text from all text parts
   */
  extractMessageText(userMessage) {
    if (!userMessage || !userMessage.parts || !Array.isArray(userMessage.parts)) {
      return '';
    }

    return userMessage.parts
      .filter(part => part.kind === 'text' && part.text)
      .map(part => part.text)
      .join(' ');
  }

  /**
   * Create a successful task result
   * @param {object} task - The task being executed
   * @param {string} responseText - The text response to include
   * @returns {object} Task object with completed status and response
   */
  createSuccessResult(task, responseText) {
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return {
      id: task.id,
      contextId: task.contextId,
      status: { state: 'completed' },
      history: [
        ...(task.history || []),
        {
          messageId: messageId,
          role: 'agent',
          parts: [
            {
              kind: 'text',
              text: responseText
            }
          ]
        }
      ]
    };
  }

  /**
   * Create a failed task result
   * @param {object} task - The task being executed
   * @param {string} errorMessage - The error message
   * @returns {object} Task object with failed status
   */
  createErrorResult(task, errorMessage) {
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return {
      id: task.id,
      contextId: task.contextId,
      status: {
        state: 'failed',
        error: {
          code: -32000,
          message: errorMessage
        }
      },
      history: [
        ...(task.history || []),
        {
          messageId: messageId,
          role: 'agent',
          parts: [
            {
              kind: 'text',
              text: `Error: ${errorMessage}`
            }
          ]
        }
      ]
    };
  }
}

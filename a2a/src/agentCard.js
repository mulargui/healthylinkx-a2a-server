/**
 * Agent Card definition using A2A SDK structure
 * @module agentCard
 */

/**
 * Create an agent card for the HealthyLinkx Doctor Search Agent
 * @param {string} baseUrl - The base URL for the agent
 * @param {object} config - Configuration object with a2a settings
 * @returns {object} Agent card object conforming to A2A specification
 */
export function createAgentCard(baseUrl, config) {
  return {
    name: config.a2a.agentName,
    description: 'Search for doctors in the HealthyLinkx directory using natural language queries. Supports filtering by name, zipcode, specialty, and gender.',
    url: `${baseUrl}/a2a`,
    version: config.a2a.agentVersion,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [
      {
        id: 'doctor-search',
        name: 'Doctor Search',
        description: 'Search for doctors by name, zipcode, specialty, or gender',
        tags: ['healthcare', 'doctor', 'search', 'medical'],
        inputModes: ['text'],
        outputModes: ['text'],
        examples: [
          'Find doctors named Smith in 10001',
          'Search for female cardiologist named Johnson in 90210',
          'Find doctors in zipcode 12345'
        ]
      }
    ]
  };
}

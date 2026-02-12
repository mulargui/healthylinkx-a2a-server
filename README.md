# healthylinkx-a2a-server
A2A interface to Healthylinkx functionality instead of an API. Allows integration with LLM apps and agents.

Healthylinkx helps you find doctors with the help of your social network. Think of Healthylinkx as a combination of Yelp, Linkedin and Facebook.

Healthylinkx is an early prototype that combines open data of doctors and specialists from the US Department of Health. It allows you to search for doctors based on location, specialization, genre or name.

Healthylinx is a classic three tiers app: front-end (ux), service API and data store. This architecture makes it very adequate to test different technologies and I use it for getting my hands dirty on new stuff.

This repo replaces the Healthylinkx API with a A2A Server. With this new interface you can integrate Healthylinkx with any LLM powered app or agent. 

We use different AWS resources: RDS for the datastore and Lambda for the MCP Server.

To know more about the datastore this repo has more details https://github.com/mulargui/healthylinkx-mysql.git

This repo is based on similar work done to support MCP in Healthylinkx: https://github.com/mulargui/healthylinkx-mcp-server.git

Kudos on building this A2A interface goes to Claude Code. I didn't write a single line of code. I used Claude Code as a experienced colleague and guided him on the process of creating and debugging the code. We started from the code used for MCP and Claude Code easily created a new endpoint to support A2A. We used A2A Inspector to test the A2A Server, more about A2A Inspector here: https://github.com/a2aproject/a2a-inspector. Several issues surfaced during testing and Claude Code was able to fix them all provided with good directions and context data. I highly recommend to use plan mode that forces Claude to think deeply.

## A2A Protocol Support

This repo now includes support for the Agent-to-Agent (A2A) protocol. The A2A protocol, originally developed by Google and now maintained by the Linux Foundation, enables AI agents to communicate and collaborate with each other.

The A2A server runs as a separate AWS Lambda function, implements JSON-RPC 2.0 over HTTPS and exposes the same doctor search functionality through a natural language interface.

### A2A Endpoints

- **Agent Card (Metadata)**: `GET /.well-known/agent.json`
- **JSON-RPC Endpoint**: `POST /a2a`
- **Health Check**: `GET /health`

### Example A2A Request

```bash
curl -X POST https://[a2a-lambda-url]/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "message/send",
    "params": {
      "message": "Find female cardiologist named Johnson in 90210"
    },
    "id": "1"
  }'
```

### Supported A2A Methods

- `message/send` - Synchronous doctor search with natural language queries

### Message Format

Natural language queries are parsed to extract search parameters. Examples:
- "Find doctors named Smith in 10001"
- "Search for female cardiologist in zipcode 90210"
- "Find doctors named Johnson"

**Files and directories:**

/docs - Documentation of the code (partial) generated automatically.\
/a2a/src - code of the A2A Agent Server.\
/a2a/infra - code to deploy and delete the A2A Server using the AWS SDK for node.js.\
/datastore/infra - code to create and delete the RDS MySQL database.\
/config.json - Configuration values for A2A and datastore.\
/deploy.sh and remove.sh - shellscripts to deploy or remove all the infrastructure from/to AWS.\

Enjoy playing with A2A!!!

### Update 1/19/2026
* First update. I created (and merged) the remove_express branch to remove the use of express web server and the use of AWS Lambda Web Adapter to route Lambda requests to the web server. Now the code is leaner and theoretically faster. Kudos again to Claude code for the changes and the new code.
* Second update. I created (and merged) the a2a-js branch to use the a2a-js library (part of the standard a2a protocol) instead of managing messages in raw format. It took Claude Code about 7 minutes to build a plan. It didn't know the a2a-js library and researched the web (several sites and github repos) to learn about it. It succeeded at the first attempt - very impressive! It is tested with a2a-inspector.

### Update 2/12/2026
I did a similar exercise with Github Copilot. You can see the results in the github_copilot branch. I used GPT 5.2 for this POC. I needed to work harder to make it deployable, with many corrections to GPT. The code now deploys correctly but doesn't work, the a2a implementation is incorrect. I'm stopping here as it is taken too much time and effort to direct GPT. The code is also unnecessary complicated for my own taste. I might try in the future with GPT 5.2 codex, which should provide better results.
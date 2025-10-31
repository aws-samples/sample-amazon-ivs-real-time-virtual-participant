# Virtual Participant Container

A containerized virtual participant system for Amazon IVS Real-Time stages that can join stages, publish video content, and be managed remotely through WebSocket connections.

## Overview

This container provides a virtual participant that can:

- Join Amazon IVS Real-Time stages using participant tokens
- Publish video content to the stage
- Run in a headless Chrome environment with Puppeteer
- Provide real-time status updates via AppSync GraphQL subscriptions

## Monorepo Structure

The virtual participant system uses a monorepo structure with shared components:

- **common/** - Shared module containing server utilities used by all virtual participant implementations
  - AppSync subscriber for GraphQL subscriptions
  - DynamoDB client for state management
  - S3 client for asset retrieval
  - Lambda token provider for secure token management
- **nova-s2s/** - Example real-time conversational virtual participant using Amazon Nova Sonic (Speech-to-Speech)
- **gpt-realtime/** - Example real-time conversational virtual participant using gpt-realtime
- **asset-publisher/** - Example asset-based virtual participant that publishes pre-recorded media

Each implementation shares the common server utilities while maintaining its own client application logic.

## Architecture

Each virtual participant container consists of several key components:

### Client Application (Browser Context)
- **Main Application** (`src/main.ts`): Powered by Puppeteer with headless Chrome
- **Stage Management** (`src/stage/`): Manages IVS Real-Time stage interactions
- **Media Processing** (`src/processor/`): Handles video/audio stream processing
- **Utilities** (`src/utils/`): Helper functions for media, common operations, and VP-specific logic
- **Internal Overrides** (`src/internal/`): IVS client customizations

### Server Application (Node.js Context)
- **WebSocket Server** (`server/websocket-server.ts`): Interfaces with AWS services and communicates with the browser context
- **Shared Common Module** (`../common/`): Provides reusable server utilities for AppSync, DynamoDB, S3, and token management

### Process Management
- **Supervisor** (`supervisor/`): Manages multiple processes within the container

## WebSocket API

The client and server contexts in the virtual participant container communicate through a WebSocket server on local port `3001` running within the container instance.

### Server Messages (from WebSocket server to Puppeteer)

#### Status Update

Sent to the client when server detects a notable change in the AppSync GraphQL API. For example, this event is sent when a virtual participant is invited to or kicked from a stage.

```json
{
  "type": "vp.update",
  "status": "connected",
  "metadata": {
    "timestamp": "2023-01-01T00:00:00.000Z"
  }
}
```

### Client Messages (from Puppeteer to the WebSocket server)

#### Ready Status

Sent to the server when the client app is loaded.

```json
{
  "type": "vp.ready"
}
```

#### Subscribe to VP Updates

Sent to the server when the client app is ready to subscribe to `vp.update` events.

```json
{
  "type": "vp.subscribe_vp"
}
```

#### Joined Stage

Sent to the server when the client joins a stage.

```json
{
  "type": "vp.joined_stage",
  "stageArn": "STAGE_ARN",
  "participantId": "PARTICIPANT_ID"
}
```

#### Left Stage

Sent to the server when the client leaves a stage.

```json
{
  "type": "vp.left_stage"
}
```

#### Error Report

Sent to the server when the client encounters an issue.

```json
{
  "type": "vp.error",
  "error": "ERROR_DESCRIPTION"
}
```

## Virtual Participant States

The virtual participant progresses through different states during its lifecycle:

- **INVITED**: VP has been invited to join a stage and is preparing to connect
- **KICKED**: VP has been removed from a stage (either manually or due to an error)
- **CONNECTED**: VP is successfully connected to the stage but not yet publishing media
- **PUBLISHED**: VP is actively publishing audio/video media streams to the stage

State transitions are managed automatically by the container based on changes made to the AppSync GraphQL API and communicated via WebSocket messages to enable real-time monitoring and control.

## Configuration

### Stage Configuration

The virtual participant automatically handles:

- IVS Real-Time stage connection using provided participant tokens
- Participant token validation and refresh
- Media stream publishing with configurable video/audio settings
- Error handling and automatic reconnection attempts

## Logging

Container logs are sent to the ECS task and can be observed in the ECS service console.

## Local Development

### Prerequisites

1. **Install Dependencies**

   From the root of each virtual participant implementation:

   ```bash
   # For nova-s2s
   cd virtualparticipants/nova-s2s
   npm install
   
   # For gpt-realtime
   cd virtualparticipants/gpt-realtime
   npm install
   
   # For asset-publisher
   cd virtualparticipants/asset-publisher
   npm install
   
   # Build the common module (required for all)
   cd virtualparticipants/common
   npm install
   npm run build
   ```

2. If building or running the docker images, make sure that docker desktop is running.

## Building Docker Images

The virtual participant containers use a monorepo structure with a shared `common` module. When building the Docker images, you must use the `virtualparticipants/` directory as the build context.

### Build nova-s2s container

```bash
docker build --platform linux/amd64 -t virtualparticipant-nova -f virtualparticipants/nova-s2s/Dockerfile virtualparticipants/
```

### Build gpt-realtime container

```bash
docker build --platform linux/amd64 -t virtualparticipant-gpt -f virtualparticipants/gpt-realtime/Dockerfile virtualparticipants/
```

### Build asset-publisher container

```bash
docker build --platform linux/amd64 -t virtualparticipant-asset -f virtualparticipants/asset-publisher/Dockerfile virtualparticipants/
```

## Running Docker Images Locally

When running the virtual participant containers locally with Docker, you must manually pass a participant token through the `PARTICIPANT_TOKENS` environment variable. The examples below show how to run each container type.

### Nova S2S Container

The Nova S2S container requires AWS credentials to access Amazon Bedrock services:

```bash
docker run --init -it -p 80:80 \
  -e PARTICIPANT_TOKENS="<PARTICIPANT_TOKEN_HERE>" \
  -e AWS_ACCESS_KEY_ID="<AWS_ACCESS_KEY>" \
  -e AWS_SECRET_ACCESS_KEY="<AWS_SECRET_KEY>" \
  -e BEDROCK_REGION="us-east-1" \
  --platform linux/amd64 \
  virtualparticipant-nova:latest
```

**Environment Variables:**
- `PARTICIPANT_TOKENS`: IVS stage participant token (required)
- `AWS_ACCESS_KEY_ID`: AWS access key for Bedrock access (required)
- `AWS_SECRET_ACCESS_KEY`: AWS secret key for Bedrock access (required)
- `BEDROCK_REGION`: AWS region for Bedrock services (default: `us-east-1`)
- `NOVA_MODEL_ID`: Nova Sonic model ID (optional, default: `amazon.nova-sonic-v1:0`)
- `NOVA_VOICE_ID`: Voice ID for speech synthesis. Available voices can be viewed in the [Amazon Nova docs](https://docs.aws.amazon.com/nova/latest/userguide/prompting-speech-voice-language.html). (optional, default: `matthew`)
- `NOVA_SYSTEM_PROMPT`: Custom system prompt for the conversational agent (optional)

### GPT-Realtime Container

The GPT-Realtime container requires an OpenAI API key:

```bash
docker run --init -it -p 80:80 \
  -e PARTICIPANT_TOKENS="<PARTICIPANT_TOKEN_HERE>" \
  -e OPENAI_API_KEY="<OPENAI_API_KEY_HERE>" \
  --platform linux/amd64 \
  virtualparticipant-gpt:latest
```

**Environment Variables:**
- `PARTICIPANT_TOKENS`: IVS stage participant token (required)
- `OPENAI_API_KEY`: OpenAI API key for GPT-Realtime access (required)

### Asset-Publisher Container

The Asset-Publisher container publishes pre-recorded media and requires minimal configuration:

```bash
docker run --init -it -p 80:80 \
  -e PARTICIPANT_TOKENS="<PARTICIPANT_TOKEN_HERE>" \
  --platform linux/amd64 \
  virtualparticipant-asset:latest
```

**Environment Variables:**
- `PARTICIPANT_TOKENS`: IVS stage participant token (required)
- `AWS_ACCESS_KEY_ID`: AWS access key (optional, needed if assets are stored in S3)
- `AWS_SECRET_ACCESS_KEY`: AWS secret key (optional, needed if assets are stored in S3)

**Note:** When running locally, the containers will start on port 80 and join the stage using the provided participant token. Join the same stage using a different participant token to interact with the virtual participant.

### Running the client application only

1. **Start Development Server**

   From the specific virtual participant directory:

   ```bash
   # For nova-s2s
   cd virtualparticipants/nova-s2s
   npm start
   
   # For gpt-realtime
   cd virtualparticipants/gpt-realtime
   npm start
   
   # For asset-publisher
   cd virtualparticipants/asset-publisher
   npm start
   ```

   The webpage will be available at `http://localhost:3000/`. When developing locally, you can provide a stage token to the container as a URL parameter: `http://localhost:3000/?token=PARTICIPANT_TOKEN`.

### Running the server application only

1. **Start WebSocket Server**

   From the specific virtual participant directory:

   ```bash
   # For nova-s2s
   cd virtualparticipants/nova-s2s
   npx tsx server/websocket-server.ts
   
   # For gpt-realtime
   cd virtualparticipants/gpt-realtime
   npx tsx server/websocket-server.ts
   
   # For asset-publisher
   cd virtualparticipants/asset-publisher
   npx tsx server/websocket-server.ts
   ```

   The WebSocket server will be running on port `3001`.

## Project Structure

```
virtualparticipants/
├── common/                           # Shared module
│   ├── server/                      # Server utilities
│   │   ├── appsync-subscriber.ts   # AppSync GraphQL subscriptions
│   │   ├── dynamodb-client.ts      # DynamoDB operations
│   │   ├── s3.ts                   # S3 operations
│   │   └── token/                  # Token management
│   │       └── lambda-token-provider.ts
│   ├── package.json
│   └── tsconfig.json
│
├── nova-s2s/                        # Nova Sonic VP implementation
│   ├── src/                        # Client application
│   │   ├── main.ts                # Main entry point
│   │   ├── stage/                 # Stage management
│   │   ├── processor/             # Media processing
│   │   ├── internal/              # IVS client overrides
│   │   ├── types/                 # TypeScript definitions
│   │   └── utils/                 # Utility functions
│   ├── server/                     # Server application
│   │   ├── websocket-server.ts   # WebSocket server
│   │   └── nova-s2s-proxy.ts     # Bedrock Nova Sonic proxy
│   ├── supervisor/                # Process management
│   ├── scripts/                   # Utility scripts
│   ├── pulse/                     # Audio system configuration
│   ├── Dockerfile                 # Container definition
│   ├── package.json
│   └── tsconfig.json
│
├── gpt-realtime/                    # GPT Realtime VP implementation
│   ├── src/                        # Client application
│   │   ├── main.ts                # Main entry point
│   │   ├── stage/                 # Stage management
│   │   ├── processor/             # Media processing
│   │   ├── internal/              # IVS client overrides
│   │   ├── types/                 # TypeScript definitions
│   │   └── utils/                 # Utility functions
│   ├── server/                     # Server application
│   │   ├── websocket-server.ts   # WebSocket server
│   │   └── openai-proxy.ts       # OpenAI API proxy
│   ├── supervisor/                # Process management
│   ├── scripts/                   # Utility scripts
│   ├── pulse/                     # Audio system configuration
│   ├── Dockerfile                 # Container definition
│   ├── package.json
│   └── tsconfig.json
│
├── asset-publisher/                # Asset publisher VP implementation
│   ├── src/                       # Client application
│   │   ├── main.ts               # Main entry point
│   │   ├── stage/                # Stage management
│   │   ├── processor/            # Media processing
│   │   ├── internal/             # IVS client overrides
│   │   ├── types/                # TypeScript definitions
│   │   └── utils/                # Utility functions
│   ├── server/                    # Server application
│   │   └── websocket-server.ts  # WebSocket server
│   ├── supervisor/               # Process management
│   ├── scripts/                  # Utility scripts
│   ├── Dockerfile                # Container definition
│   ├── package.json
│   └── tsconfig.json
│
└── README.md                      # This file
```

## Extending the Virtual Participant

To create a new virtual participant implementation:

1. Create a new directory under `virtualparticipants/` for your implementation
2. Use the shared `common` module for server utilities (AppSync, DynamoDB, S3, tokens)
3. Implement your client application in the `src/` directory
4. Create a WebSocket server in the `server/` directory that uses the common utilities
5. Add a Dockerfile that uses `virtualparticipants/` as the build context to include the common module

# Virtual Participant Container

A containerized virtual participant system for Amazon IVS Real-Time stages that can join stages, publish video content, and be managed remotely through WebSocket connections.

## Overview

This container provides a virtual participant that can:

- Join Amazon IVS Real-Time stages using participant tokens
- Publish video content to the stage
- Run in a headless Chrome environment with Puppeteer
- Provide real-time status updates via AppSync GQL subscriptions

## Architecture

The virtual participant container consists of several key components:

- **Browser JavaScript context** (`src/main.ts`): Powered by Puppeteer with headless Chrome. Handles communication with the NodeJS server
- **Stage Management** (`src/stage/`): Manages IVS Real-Time stage interactions
- **Media Processing** (`src/processor/`): Handles video/audio stream processing
- **NodeJS Server context** (`server/`): Websocket server that interfaces with AWS services

## WebSocket API

The client and server contexts in the virtual participant container communicate through a WebSocket server on a local port `3001` running within the container instance.

### Server Messages (from websocket server to puppeteer)

#### Status Update

Sent to the client when server detects a notable change in the Appsync GraphQL API. For example, this event is sent when the participant is Kicked or Invited to a stage.

```json
{
  "type": "vp.update",
  "status": "connected",
  "metadata": {
    "timestamp": "2023-01-01T00:00:00.000Z"
  }
}
```

### Client Messages (from puppeteer to the websocket server)

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

- **INVITED**: VP has been invited to join a stage
- **KICKED**: VP has been removed from a stage
- **CONNECTED**: VP is connected to the stage
- **PUBLISHED**: VP is actively publishing media to the stage

## Configuration

### Stage Configuration

The virtual participant automatically handles:

- IVS Real-Time stage connection
- Participant token validation
- Media stream publishing
- Error handling and reconnection

## Logging

Container logs are sent to the ECS task and can be observed in the ECS service console.

## Local development

### Client application

1. **Install Dependencies**

   ```bash
   npm install
   ```

2. **Start Development Server**
   ```bash
   npm start
   ```

The webpage will be available at `http://localhost:3000/`. When developing locally, you can provide a stage token to the container as a URL parameter: `http://localhost:3000/?token=PARTICIPANT_TOKEN`.

### Server application

1. **Start WebSocket Server**
   ```bash
   npx tsx server/websocket-server.ts
   ```

The websocket server will be running on port `3001`.

### Project Structure

```
virtualparticipant/
├── src/                      # Source code
│   ├── main.ts              # Main application entry
│   ├── stage/               # Stage management
│   ├── processor/           # Media processing
│   ├── utils/               # Utility functions
│   └── types/               # TypeScript definitions
├── server/                   # WebSocket server
├── supervisor/              # Process management
├── scripts/                 # Utility scripts
├── Dockerfile               # Container definition
├── package.json             # Dependencies
└── README.md                # This file
```

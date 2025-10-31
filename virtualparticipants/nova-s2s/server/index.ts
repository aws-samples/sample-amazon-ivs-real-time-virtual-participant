import { VirtualParticipantWebSocketServer } from './websocket-server';

const PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT) : 3001;

console.info('Starting Nova S2S Virtual Participant WebSocket Server...');

const server = new VirtualParticipantWebSocketServer(PORT);

process.on('SIGTERM', () => {
  console.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

export default server;

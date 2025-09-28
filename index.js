require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { createPollManager } = require('./pollManager');

const app = express();
const corsOrigin = process.env.CORS_ORIGIN || 'https://live-polling-system-frontend-pearl.vercel.app'; // Secure: Restrict to frontend URL
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'] }
});

const pollManager = createPollManager(io);

io.on('connection', (socket) => {
  require('./sockets')(io, socket, pollManager);
});

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Root endpoint
app.get('/', (_req, res) => {
  res.json({ 
    message: 'Live Polling System Backend',
    status: 'running',
    endpoints: {
      health: '/health',
      socket: 'Socket.IO connection available'
    }
  });
});

// Catch-all route for any other requests
app.get('*', (_req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    message: 'This is a Socket.IO server. Please connect via Socket.IO client.',
    availableEndpoints: ['/', '/health']
  });
});

const PORT = process.env.PORT || 4000;
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Polling server running on port ${PORT}`);
    console.log(`CORS allowed origin: ${corsOrigin}`);
  });
}

module.exports = { app, server, io };
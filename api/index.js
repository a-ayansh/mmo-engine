import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server as SocketIO } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';

import MatchmakingService from './services/MatchmakingService.js';
import PlayerService from './services/PlayerService.js';
import GameService from './services/GameService.js';
import RedisClient from './config/redis.js';
import RabbitMQClient from './config/rabbitmq.js';

class GameServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new SocketIO(this.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    this.matchmakingService = new MatchmakingService();
    this.playerService = new PlayerService();
    this.gameService = new GameService();

    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketHandlers();
  }

  setupMiddleware() {
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static('public'));
    this.app.use((req, res, next) => {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
      );
      next();
    });
  }

  setupRoutes() {
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });

    this.app.post('/api/players', async (req, res) => {
      try {
        const { username, gameMode } = req.body;
        const player = await this.playerService.createPlayer(username, gameMode);
        res.json(player);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.get('/api/players/:id', async (req, res) => {
      try {
        const player = await this.playerService.getPlayer(req.params.id);
        res.json(player);
      } catch (error) {
        res.status(404).json({ error: 'Player not found' });
      }
    });

    this.app.get('/api/queue/status', async (req, res) => {
      try {
        const status = await this.matchmakingService.getQueueStatus();
        res.json(status);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/games/:id', async (req, res) => {
      try {
        const game = await this.gameService.getGame(req.params.id);
        res.json(game);
      } catch (error) {
        res.status(404).json({ error: 'Game not found' });
      }
    });
  }

  setupSocketHandlers() {
  this.io.on('connection', (socket) => {
    console.log(`🎮 Player connected: ${socket.id}`);

    // DEBUG: Listen for all raw messages
    socket.onAny((event, ...args) => {
      console.log(`📥 [${socket.id}] Event received: ${event}`, args);
    });

    socket.on('join_queue', async (data) => {
      try {
        console.log(`🧩 [${socket.id}] Join queue request:`, data);
        const { playerId, gameMode, preferences } = data;
        await this.matchmakingService.addToQueue(playerId, gameMode, preferences, socket.id);
        socket.join(`queue_${gameMode}`);
        socket.emit('queue_joined', { status: 'success', gameMode });
      } catch (error) {
        console.error(`❌ Error joining queue [${socket.id}]:`, error.message);
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('leave_queue', async (data) => {
      try {
        console.log(`📤 [${socket.id}] Leave queue request:`, data);
        const { playerId, gameMode } = data;
        await this.matchmakingService.removeFromQueue(playerId, gameMode);
        socket.leave(`queue_${gameMode}`);
        socket.emit('queue_left', { status: 'success' });
      } catch (error) {
        console.error(`❌ Error leaving queue [${socket.id}]:`, error.message);
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('game_action', async (data) => {
      try {
        console.log(`🎯 [${socket.id}] Game action:`, data);
        const { gameId, action, payload } = data;
        await this.gameService.handleGameAction(gameId, socket.id, action, payload);
      } catch (error) {
        console.error(`❌ Error processing game action [${socket.id}]:`, error.message);
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('disconnect', async (reason) => {
      console.log(`❌ Player disconnected: ${socket.id} | Reason: ${reason}`);
      await this.matchmakingService.handlePlayerDisconnect(socket.id);
    });

    // DEBUG: WebSocket error tracking
    socket.on('error', (err) => {
      console.error(`🚨 WebSocket error [${socket.id}]:`, err.message);
    });
  });

  this.matchmakingService.on('match_found', (matchData) => {
    console.log(`✅ Match found: ${matchData.gameId}`);
    matchData.players.forEach(player => {
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket) {
        socket.join(`game_${matchData.gameId}`);
        socket.emit('match_found', {
          gameId: matchData.gameId,
          players: matchData.players.map(p => ({ id: p.id, username: p.username, rating: p.rating })),
          gameMode: matchData.gameMode
        });
      }
    });
  });

  this.gameService.on('game_update', (gameId, update) => {
    console.log(`🔄 Game update for ${gameId}:`, update);
    this.io.to(`game_${gameId}`).emit('game_update', update);
  });
}

  async start() {
    try {
      await RedisClient.client.connect(); // ensure Redis is connected
      await RabbitMQClient.connect();

      const PORT = process.env.PORT || 3000;
      this.server.listen(PORT, () => {
        console.log(`🚀 Matchmaking server running on port ${PORT}`);
      });

      // Handle process exit
      process.on('SIGINT', async () => {
        console.log('🛑 Shutting down...');
        await RabbitMQClient.close();
        await RedisClient.disconnect();
        process.exit(0);
      });

    } catch (error) {
      console.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }
}

const gameServer = new GameServer();
gameServer.start();

export default GameServer;

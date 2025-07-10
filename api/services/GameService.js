import EventEmitter from 'events';
import RedisClient from '../config/redis.js';
import PlayerService from './PlayerService.js';

class GameService extends EventEmitter {
  constructor() {
    super();
    this.playerService = new PlayerService();
    this.activeGames = new Map();
  }

  async createGame(gameId, players, gameMode) {
    const game = {
      id: gameId,
      players: players.map(p => ({
        id: p.id,
        username: p.username,
        rating: p.rating,
        socketId: p.socketId
      })),
      gameMode,
      status: 'starting',
      createdAt: Date.now(),
      config: this.getGameConfig(gameMode)
    };

    await RedisClient.setEx(`game:${gameId}`, 7200, JSON.stringify(game));
    this.activeGames.set(gameId, game);

    setTimeout(() => {
      this.startGame(gameId);
    }, 5000);

    return game;
  }

  async getGame(gameId) {
    if (this.activeGames.has(gameId)) {
      return this.activeGames.get(gameId);
    }

    const gameData = await RedisClient.get(`game:${gameId}`);
    if (gameData) {
      const game = JSON.parse(gameData);
      this.activeGames.set(gameId, game);
      return game;
    }

    return null;
  }

  async startGame(gameId) {
    const game = await this.getGame(gameId);
    if (!game) return;

    game.status = 'active';
    game.startedAt = Date.now();

    await this.updateGame(gameId, game);
    this.emit('game_update', gameId, { type: 'game_started', game });

    console.log(`Game ${gameId} started with ${game.players.length} players`);
  }

  async handleGameAction(gameId, socketId, action, payload) {
    const game = await this.getGame(gameId);
    if (!game || game.status !== 'active') return;

    const player = game.players.find(p => p.socketId === socketId);
    if (!player) return;

    switch (game.gameMode) {
      case 'chess':
        await this.handleChessAction(game, player, action, payload);
        break;
      case 'fps':
        await this.handleFPSAction(game, player, action, payload);
        break;
      default:
        console.log(`Unhandled action for game mode ${game.gameMode}`);
    }
  }

  async handleChessAction(game, player, action, payload) {
    switch (action) {
      case 'move': {
        const { from, to } = payload;
        console.log(`Chess move: ${player.username} moved from ${from} to ${to}`);
        this.emit('game_update', game.id, {
          type: 'move',
          playerId: player.id,
          move: { from, to },
          timestamp: Date.now()
        });
        break;
      }

      case 'resign':
        await this.endGame(game.id, player.id, 'resignation');
        break;

      default:
        console.warn(`Unhandled chess action: ${action}`);
    }
  }

  async handleFPSAction(game, player, action, payload) {
    switch (action) {
      case 'position_update':
        this.emit('game_update', game.id, {
          type: 'player_position',
          playerId: player.id,
          position: payload.position,
          rotation: payload.rotation,
          timestamp: Date.now()
        });
        break;

      case 'shoot':
        this.emit('game_update', game.id, {
          type: 'player_shoot',
          playerId: player.id,
          target: payload.target,
          timestamp: Date.now()
        });
        break;

      default:
        console.warn(`Unhandled FPS action: ${action}`);
    }
  }

  async endGame(gameId, winnerId = null, reason = 'completed') {
    const game = await this.getGame(gameId);
    if (!game) return;

    game.status = 'finished';
    game.endedAt = Date.now();
    game.result = { winnerId, reason };

    if (game.gameMode === 'chess' && game.players.length === 2) {
      const [player1, player2] = game.players;

      if (winnerId === player1.id) {
        await this.playerService.updatePlayerRating(player1.id, game.gameMode, player2.rating, 'win');
        await this.playerService.updatePlayerRating(player2.id, game.gameMode, player1.rating, 'loss');
      } else if (winnerId === player2.id) {
        await this.playerService.updatePlayerRating(player2.id, game.gameMode, player1.rating, 'win');
        await this.playerService.updatePlayerRating(player1.id, game.gameMode, player2.rating, 'loss');
      } else {
        await this.playerService.updatePlayerRating(player1.id, game.gameMode, player2.rating, 'draw');
        await this.playerService.updatePlayerRating(player2.id, game.gameMode, player1.rating, 'draw');
      }
    }

    await this.updateGame(gameId, game);
    this.emit('game_update', gameId, { type: 'game_ended', result: game.result });

    setTimeout(() => {
      this.activeGames.delete(gameId);
    }, 60000);

    console.log(`Game ${gameId} ended: ${reason}`);
  }

  async updateGame(gameId, game) {
    await RedisClient.setEx(`game:${gameId}`, 7200, JSON.stringify(game));
    this.activeGames.set(gameId, game);
  }

  getGameConfig(gameMode) {
    const configs = {
      fps: {
        maxPlayers: 10,
        mapSize: { width: 1000, height: 1000 },
        gameTime: 600000
      },
      chess: {
        maxPlayers: 2,
        timeControl: '10+0',
        increment: 0
      },
      moba: {
        maxPlayers: 10,
        teamSize: 5,
        gameTime: 1800000
      },
      rts: {
        maxPlayers: 2,
        mapSize: '128x128',
        resources: ['minerals', 'gas']
      }
    };
    return JSON.parse(JSON.stringify(configs[gameMode] || {}));
  }
}

export default GameService;

import EventEmitter from 'events';
import RedisClient from '../config/redis.js';
import RabbitMQClient from '../config/rabbitmq.js';
import PlayerService from './PlayerService.js';
import GameService from './GameService.js';
import { v4 as uuidv4 } from 'uuid';

class MatchmakingService extends EventEmitter {
  constructor() {
    super();
    this.playerService = new PlayerService();
    this.gameService = new GameService();
    this.matchmakingIntervals = new Map();
    this.startMatchmakingLoop();
  }

  async addToQueue(playerId, gameMode, preferences = {}, socketId) {
    const player = await this.playerService.getPlayer(playerId);
    if (!player) throw new Error('Player not found');

    const queueKey = `queue:${gameMode}`;
    const playerData = {
      id: playerId,
      username: player.username,
      rating: player.ratings[gameMode] || 1000,
      preferences,
      socketId,
      joinedAt: Date.now(),
      searchExpansion: 0
    };

    await RedisClient.zAdd(queueKey, [{ score: playerData.rating, value: JSON.stringify(playerData) }]);
    await RedisClient.expire(queueKey, 3600);

    await RabbitMQClient.publish('matchmaking.queue.join', {
      playerId,
      gameMode,
      timestamp: Date.now()
    });

    console.log(`Player ${playerId} joined ${gameMode} queue`);
  }

  async removeFromQueue(playerId, gameMode) {
    const queueKey = `queue:${gameMode}`;
    const members = await RedisClient.zRange(queueKey, 0, -1);

    for (const member of members) {
      const playerData = JSON.parse(member);
      if (playerData.id === playerId) {
        await RedisClient.zRem(queueKey, member);
        break;
      }
    }

    await RabbitMQClient.publish('matchmaking.queue.leave', {
      playerId,
      gameMode,
      timestamp: Date.now()
    });

    console.log(`Player ${playerId} left ${gameMode} queue`);
  }

  async handlePlayerDisconnect(socketId) {
    const gameModes = ['fps', 'chess', 'moba', 'rts'];

    for (const gameMode of gameModes) {
      const queueKey = `queue:${gameMode}`;
      const members = await RedisClient.zRange(queueKey, 0, -1);

      for (const member of members) {
        const playerData = JSON.parse(member);
        if (playerData.socketId === socketId) {
          await RedisClient.zRem(queueKey, member);
          console.log(`Removed disconnected player ${playerData.id} from ${gameMode} queue`);
        }
      }
    }
  }

  startMatchmakingLoop() {
    const gameModes = ['fps', 'chess', 'moba', 'rts'];

    gameModes.forEach(gameMode => {
      const interval = setInterval(() => {
        this.processMatchmaking(gameMode);
      }, 2000);
      this.matchmakingIntervals.set(gameMode, interval);
    });
  }

  async processMatchmaking(gameMode) {
    try {
      const queueKey = `queue:${gameMode}`;
      const members = await RedisClient.zRange(queueKey, 0, -1);

      if (members.length < 2) return;

      const players = members.map(m => JSON.parse(m));
      const matches = this.findMatches(players, gameMode);

      for (const match of matches) {
        await this.createMatch(match, gameMode);

        for (const player of match) {
          const playerStr = JSON.stringify(player);
          await RedisClient.zRem(queueKey, playerStr);
        }
      }
    } catch (error) {
      console.error(`Matchmaking error for ${gameMode}:`, error);
    }
  }

  findMatches(players, gameMode) {
    const matches = [];
    const playersPerMatch = this.getPlayersPerMatch(gameMode);
    const usedPlayers = new Set();

    players.sort((a, b) => a.joinedAt - b.joinedAt);

    for (let i = 0; i < players.length; i++) {
      if (usedPlayers.has(players[i].id)) continue;

      const potentialMatch = [players[i]];
      usedPlayers.add(players[i].id);

      for (let j = i + 1; j < players.length && potentialMatch.length < playersPerMatch; j++) {
        if (usedPlayers.has(players[j].id)) continue;

        if (this.arePlayersCompatible(players[i], players[j], gameMode)) {
          potentialMatch.push(players[j]);
          usedPlayers.add(players[j].id);
        }
      }

      if (potentialMatch.length === playersPerMatch) {
        matches.push(potentialMatch);
      } else {
        potentialMatch.forEach(p => usedPlayers.delete(p.id));
      }
    }

    return matches;
  }

  arePlayersCompatible(player1, player2, gameMode) {
    const ratingDiff = Math.abs(player1.rating - player2.rating);
    const waitTime = Math.max(Date.now() - player1.joinedAt, Date.now() - player2.joinedAt);
    const maxRatingDiff = 100 + Math.floor(waitTime / 10000) * 30;

    if (ratingDiff > maxRatingDiff) return false;

    switch (gameMode) {
      case 'fps':
        return this.checkFPSCompatibility(player1, player2);
      case 'chess':
        return this.checkChessCompatibility(player1, player2);
      default:
        return true;
    }
  }

  checkFPSCompatibility(player1, player2) {
    const p1Prefs = player1.preferences || {};
    const p2Prefs = player2.preferences || {};
    return !(p1Prefs.region && p2Prefs.region && p1Prefs.region !== p2Prefs.region);
  }

  checkChessCompatibility(player1, player2) {
    const p1Prefs = player1.preferences || {};
    const p2Prefs = player2.preferences || {};
    return !(p1Prefs.timeControl && p2Prefs.timeControl && p1Prefs.timeControl !== p2Prefs.timeControl);
  }

  async createMatch(players, gameMode) {
    const gameId = uuidv4();
    const matchData = {
      gameId,
      players,
      gameMode,
      createdAt: Date.now()
    };

    await this.gameService.createGame(gameId, players, gameMode);
    this.emit('match_found', matchData);
    await RabbitMQClient.publish('matchmaking.match.created', matchData);

    console.log(`Match created: ${gameId} with ${players.length} players`);
  }

  getPlayersPerMatch(gameMode) {
    const config = {
      fps: 10,
      chess: 2,
      moba: 10,
      rts: 2
    };
    return config[gameMode] || 2;
  }

  async getQueueStatus() {
    const gameModes = ['fps', 'chess', 'moba', 'rts'];
    const status = {};

    for (const gameMode of gameModes) {
      const queueKey = `queue:${gameMode}`;
      const count = await RedisClient.zCard(queueKey);
      const members = await RedisClient.zRange(queueKey, 0, -1);

      const avgWaitTime = members.length > 0
        ? members.reduce((sum, member) => {
            const player = JSON.parse(member);
            return sum + (Date.now() - player.joinedAt);
          }, 0) / members.length
        : 0;

      status[gameMode] = {
        playersInQueue: count,
        averageWaitTime: Math.round(avgWaitTime / 1000),
        estimatedMatchTime: this.estimateMatchTime(count, gameMode)
      };
    }

    return status;
  }

  estimateMatchTime(playersInQueue, gameMode) {
    const playersPerMatch = this.getPlayersPerMatch(gameMode);
    if (playersInQueue < playersPerMatch) {
      return 'Waiting for more players';
    }

    const potentialMatches = Math.floor(playersInQueue / playersPerMatch);
    const estimatedSeconds = Math.max(5, 30 - (potentialMatches * 5));
    return `~${estimatedSeconds}s`;
  }
}

export default MatchmakingService;

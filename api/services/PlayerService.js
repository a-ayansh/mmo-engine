import RedisClient from '../config/redis.js';
import { v4 as uuidv4 } from 'uuid';

class PlayerService {
  constructor() {
    this.eloK = 32;
  }

  async createPlayer(username, gameMode = 'fps') {
    const playerId = uuidv4();
    const player = {
      id: playerId,
      username,
      ratings: {
        fps: 1000,
        chess: 1000,
        moba: 1000,
        rts: 1000
      },
      stats: {
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0
      },
      createdAt: Date.now(),
      lastActive: Date.now()
    };

    await RedisClient.setEx(`player:${playerId}`, 86400, JSON.stringify(player));
    await RedisClient.zAdd('leaderboard:global', [{ score: player.ratings[gameMode], value: playerId }]);

    return player;
  }

  async getPlayer(playerId) {
    const playerData = await RedisClient.get(`player:${playerId}`);
    return playerData ? JSON.parse(playerData) : null;
  }

  async updatePlayerRating(playerId, gameMode, opponentRating, result) {
    const player = await this.getPlayer(playerId);
    if (!player) throw new Error('Player not found');

    const currentRating = player.ratings[gameMode];
    const expectedScore = this.calculateExpectedScore(currentRating, opponentRating);

    let actualScore;
    switch (result) {
      case 'win': actualScore = 1; break;
      case 'loss': actualScore = 0; break;
      case 'draw': actualScore = 0.5; break;
      default: throw new Error('Invalid result');
    }

    const newRating = Math.round(currentRating + this.eloK * (actualScore - expectedScore));
    player.ratings[gameMode] = Math.max(100, newRating); // Prevent very low ratings

    // Update stats
    player.stats.gamesPlayed++;
    if (result === 'win') player.stats.wins++;
    else if (result === 'loss') player.stats.losses++;
    else player.stats.draws++;

    player.lastActive = Date.now();

    await RedisClient.setEx(`player:${playerId}`, 86400, JSON.stringify(player));
    await RedisClient.zAdd(`leaderboard:${gameMode}`, [{ score: player.ratings[gameMode], value: playerId }]);

    return player;
  }

  calculateExpectedScore(playerRating, opponentRating) {
    return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
  }

  async getLeaderboard(gameMode = 'global', limit = 100) {
    const key = `leaderboard:${gameMode}`;
    const playersWithScores = await RedisClient.zRevRangeWithScores(key, 0, limit - 1);

    const leaderboard = [];
    for (let i = 0; i < playersWithScores.length; i++) {
      const { value: playerId, score: rating } = playersWithScores[i];
      const player = await this.getPlayer(playerId);

      if (player) {
        leaderboard.push({
          rank: i + 1,
          playerId,
          username: player.username,
          rating,
          gamesPlayed: player.stats.gamesPlayed
        });
      }
    }

    return leaderboard;
  }
}

export default PlayerService;

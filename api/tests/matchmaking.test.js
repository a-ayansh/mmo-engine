import MatchmakingService from '../services/MatchmakingService.js';
import PlayerService from '../services/PlayerService.js';
import RedisClient from '../config/redis.js';

let matchmakingService;
let playerService;

beforeAll(async () => {
  matchmakingService = new MatchmakingService();
  playerService = new PlayerService();
});

afterAll(async () => {
  await RedisClient.disconnect();
});

beforeEach(async () => {
  try {
    await RedisClient.client.flushAll();
  } catch (err) {
    console.error('Redis flush error:', err);
  }
});

test('should add player to queue', async () => {
  const player = await playerService.createPlayer('testPlayer', 'fps');

  await matchmakingService.addToQueue(player.id, 'fps', {}, 'socket123');

  const queueStatus = await matchmakingService.getQueueStatus();
  expect(queueStatus.fps.playersInQueue).toBe(1);
});

test('should remove player from queue', async () => {
  const player = await playerService.createPlayer('testPlayer', 'fps');

  await matchmakingService.addToQueue(player.id, 'fps', {}, 'socket123');
  await matchmakingService.removeFromQueue(player.id, 'fps');

  const queueStatus = await matchmakingService.getQueueStatus();
  expect(queueStatus.fps.playersInQueue).toBe(0);
});

test('should find compatible players', () => {
  const now = Date.now();
  const players = [
    { id: '1', rating: 1000, joinedAt: now },
    { id: '2', rating: 1050, joinedAt: now },
    { id: '3', rating: 1500, joinedAt: now }
  ];

  const matches = matchmakingService.findMatches(players, 'chess');
  expect(matches).toHaveLength(1);
  expect(matches[0]).toHaveLength(2);
});

test('should update rating correctly on win', async () => {
  const player = await playerService.createPlayer('testRating', 'chess');
  const updated = await playerService.updatePlayerRating(player.id, 'chess', 1200, 'win');

  expect(updated.ratings.chess).toBeGreaterThan(1000);
});

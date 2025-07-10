import { io } from 'socket.io-client';
import { performance } from 'perf_hooks';

class StressTest {
  constructor(serverUrl = 'http://localhost:3000', numClients = 100) {
    this.serverUrl = serverUrl;
    this.numClients = numClients;
    this.clients = [];
    this.metrics = {
      connectionsEstablished: 0,
      messagesSent: 0,
      messagesReceived: 0,
      errors: 0,
      startTime: 0,
      endTime: 0
    };
  }

  async runTest() {
    console.log(`🚀 Starting stress test with ${this.numClients} clients`);
    this.metrics.startTime = performance.now();

    const promises = [];
    for (let i = 0; i < this.numClients; i++) {
      promises.push(this.createClient(i));
      await this.sleep(20); // slight stagger to avoid overload
    }

    await Promise.all(promises);
    await this.runMatchmakingTest();
    await this.runGameActionTest();

    this.metrics.endTime = performance.now();
    this.printResults();
    this.cleanup();
  }

  async createClient(clientId) {
    return new Promise((resolve) => {
      const socket = io(this.serverUrl, {
        transports: ['websocket'],
        reconnection: false
      });

      socket.on('connect', () => {
        this.metrics.connectionsEstablished++;
        console.log(`Client ${clientId} connected`);
        resolve();
      });

      socket.on('connect_error', (error) => {
        this.metrics.errors++;
        console.error(`Client ${clientId} error:`, error.message);
        resolve(); // resolve so the test doesn't hang
      });

      socket.on('disconnect', () => {
        console.log(`Client ${clientId} disconnected`);
      });

      socket.on('match_found', (data) => {
        this.metrics.messagesReceived++;
        console.log(`Client ${clientId} got match: ${data.gameId}`);
      });

      socket.on('game_update', () => {
        this.metrics.messagesReceived++;
      });

      this.clients.push({ id: clientId, socket });
    });
  }

  async runMatchmakingTest() {
    console.log('📊 Running matchmaking stress test...');

    const joinPromises = this.clients.map(async (client, index) => {
      await this.sleep(index * 5);
      const playerId = `player_${client.id}`;
      client.socket.emit('join_queue', {
        playerId,
        gameMode: 'fps',
        preferences: { region: 'us-east' }
      });
      this.metrics.messagesSent++;
    });

    await Promise.all(joinPromises);
    await this.sleep(5000);
  }

  async runGameActionTest() {
    console.log('🎮 Running game action stress test...');

    const activeClients = this.clients.filter(c => c.socket.connected);

    for (let i = 0; i < 10; i++) {
      activeClients.forEach(client => {
        client.socket.emit('game_action', {
          gameId: 'test_game',
          action: 'position_update',
          payload: {
            position: { x: Math.random() * 1000, y: Math.random() * 1000 },
            rotation: Math.random() * 360
          }
        });
        this.metrics.messagesSent++;
      });
      await this.sleep(200);
    }
  }

  printResults() {
    const duration = (this.metrics.endTime - this.metrics.startTime) / 1000;

    console.log('\n📈 Stress Test Results:');
    console.log('========================');
    console.log(`Duration: ${duration.toFixed(2)}s`);
    console.log(`Connections Established: ${this.metrics.connectionsEstablished}/${this.numClients}`);
    console.log(`Messages Sent: ${this.metrics.messagesSent}`);
    console.log(`Messages Received: ${this.metrics.messagesReceived}`);
    console.log(`Errors: ${this.metrics.errors}`);
    console.log(`Messages/Second: ${(this.metrics.messagesSent / duration).toFixed(2)}`);
    console.log(`Success Rate: ${((this.metrics.connectionsEstablished / this.numClients) * 100).toFixed(2)}%`);
  }

  cleanup() {
    this.clients.forEach(client => {
      if (client.socket.connected) {
        client.socket.disconnect();
      }
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default StressTest;

if (process.argv[1] === decodeURI(new URL(import.meta.url).pathname)) {
  const test = new StressTest();
  test.runTest().catch(console.error);
}

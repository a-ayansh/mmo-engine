import amqp from 'amqplib';

class RabbitMQClient {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.url = process.env.RABBITMQ_URL || 'amqp://localhost';
  }

  async connect(retries = 10, delayMs = 3000) {
    console.log(`🔌 Connecting to RabbitMQ at ${this.url}`);

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        this.connection = await amqp.connect(this.url);
        this.channel = await this.connection.createChannel();

        await this.setupExchanges();
        await this.setupQueues();

        console.log('✅ Connected to RabbitMQ');
        return;
      } catch (error) {
        console.error(`❌ RabbitMQ connection attempt ${attempt} failed: ${error.message}`);
        if (attempt < retries) {
          await new Promise(res => setTimeout(res, delayMs));
        } else {
          console.error('❌ Failed to connect to RabbitMQ after maximum attempts');
          throw error;
        }
      }
    }
  }

  async setupExchanges() {
    await this.channel.assertExchange('matchmaking', 'topic', { durable: true });
    await this.channel.assertExchange('game_events', 'topic', { durable: true });
  }

  async setupQueues() {
    const queues = [
      ['matchmaking.queue.join', 'matchmaking', 'queue.join'],
      ['matchmaking.queue.leave', 'matchmaking', 'queue.leave'],
      ['matchmaking.match.created', 'matchmaking', 'match.created'],
      ['game.started', 'game_events', 'game.started'],
      ['game.ended', 'game_events', 'game.ended'],
      ['player.rating.updated', 'game_events', 'player.rating.updated']
    ];

    for (const [queue, exchange, routingKey] of queues) {
      await this.channel.assertQueue(queue, { durable: true });
      await this.channel.bindQueue(queue, exchange, routingKey);
    }
  }

  async publish(routingKey, data) {
    if (!this.channel) throw new Error('RabbitMQ channel not initialized');

    const exchange = routingKey.startsWith('matchmaking') ? 'matchmaking' : 'game_events';
    const message = Buffer.from(JSON.stringify(data));

    const published = this.channel.publish(exchange, routingKey, message, { persistent: true });

    if (!published) {
      console.warn(`⚠️ Message not published to ${exchange} with key ${routingKey}`);
    }

    return published;
  }

  async consume(queue, callback) {
    if (!this.channel) throw new Error('RabbitMQ channel not initialized');

    return this.channel.consume(queue, async (msg) => {
      if (msg) {
        try {
          const data = JSON.parse(msg.content.toString());
          await callback(data);
          this.channel.ack(msg);
        } catch (error) {
          console.error(`❌ Error processing message on ${queue}:`, error);
          this.channel.nack(msg, false, false); // dead-letter or discard
        }
      }
    }, { noAck: false });
  }

  async close() {
    if (this.channel) await this.channel.close();
    if (this.connection) await this.connection.close();
  }
}

const rabbitMQClient = new RabbitMQClient();
export default rabbitMQClient;

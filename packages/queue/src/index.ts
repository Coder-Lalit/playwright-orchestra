import * as amqp from 'amqplib';
import { Job } from '../../common/src/index.js';
import { getQueueConfig, queueNames } from '../../config/src/index.js';

type Connection = amqp.ChannelModel;
type Channel = amqp.Channel;
type Message = amqp.Message;

export interface QueueClient {
  connect(): Promise<void>;
  assertQueues(): Promise<void>;
  publishJob(queueName: string, payload: Job): Promise<void>;
  consumeJobs(queueName: string, handler: (job: Job, msg: Message) => Promise<void>): Promise<void>;
  setPrefetch(count: number): Promise<void>;
  ack(message: Message): void;
  nack(message: Message, requeue?: boolean): void;
  close(): Promise<void>;
}

export class RabbitMqQueueClient implements QueueClient {
  private connection?: Connection | undefined;
  private channel?: Channel | undefined;

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    const connection = await amqp.connect(this.url);
    this.connection = connection;
    this.channel = await connection.createChannel();
    await this.channel.prefetch(1);
  }

  async setPrefetch(count: number): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ client is not connected');
    }
    await this.channel.prefetch(Math.max(1, count));
  }

  async assertQueues(): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ client is not connected');
    }

    for (const queueName of [queueNames.execution, queueNames.retry, queueNames.results, queueNames.deadLetter]) {
      await this.channel.assertQueue(queueName, { durable: true, arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': queueNames.deadLetter } });
    }
  }

  async publishJob(queueName: string, payload: Job): Promise<void> {
    await this.publishJson(queueName, payload);
  }

  async publishJson(queueName: string, payload: unknown): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ client is not connected');
    }
    const sent = this.channel.sendToQueue(queueName, Buffer.from(JSON.stringify(payload)), { persistent: true });
    if (!sent) {
      throw new Error(`Failed to publish to ${queueName}`);
    }
  }

  async consumeJobs(queueName: string, handler: (job: Job, msg: Message) => Promise<void>): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ client is not connected');
    }

    await this.channel.consume(queueName, async (msg) => {
      if (!msg) return;
      try {
        const parsed = JSON.parse(msg.content.toString()) as Job;
        await handler(parsed, msg);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        console.error(JSON.stringify({
          event: 'JOB_REJECTED_TO_DEADLETTER',
          queue: queueName,
          error: messageText
        }));
        this.nack(msg, false);
      }
    }, { noAck: false });
  }

  ack(message: Message): void {
    this.channel?.ack(message);
  }

  nack(message: Message, requeue: boolean = true): void {
    this.channel?.nack(message, false, requeue);
  }

  async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }
}

export { queueNames, getQueueConfig };

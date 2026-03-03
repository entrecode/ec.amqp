import type { AmqpConnectionManager, ChannelWrapper, Options } from 'amqp-connection-manager';
import type { MessageProperties as AmqpMessageProperties } from 'amqplib';

export interface ConnectionOptions {
  hosts?: string[];
  user?: string;
  password?: string;
  tls?: boolean;
  vhost?: string;
  heartbeatIntervalInSeconds?: number;
  reconnectTimeInSeconds?: number;
}

export interface SubscribeOptions {
  noAck?: boolean;
  exchangeType?: string;
  durableExchange?: boolean;
  durableQueue?: boolean;
  exclusiveQueue?: boolean;
}

export interface WorkerQueueMessageProperties extends AmqpMessageProperties {
  redelivered: boolean;
}

export interface AckFunction {
  (): void;
}

export interface WorkerQueueNackFunction {
  (timeout?: number, requeue?: boolean, redirectQueue?: string): NodeJS.Timeout;
}

export interface SubscribeNackFunction {
  (timeout?: number): NodeJS.Timeout;
}

export type WorkerQueueHandler = (
  event: any,
  properties: WorkerQueueMessageProperties,
  actions: { ack: AckFunction; nack: WorkerQueueNackFunction },
) => Promise<void> | void;

export type SubscribeHandler = (
  event: any,
  properties: AmqpMessageProperties,
  actions: { ack: AckFunction; nack: SubscribeNackFunction },
) => Promise<void> | void;

export type PublishFunction = (
  routingKey: string,
  content: any,
  type?: string,
  appID?: string,
  options?: Options.Publish,
) => Promise<boolean>;

export declare class AmqpConnection {
  constructor(options?: ConnectionOptions);

  readonly connectionManager: AmqpConnectionManager;

  isReachable(): Promise<boolean>;

  workerQueue(
    queueName: string,
    exchange: string,
    bindings: string[],
    handler: WorkerQueueHandler,
    prefetch?: number,
  ): Promise<ChannelWrapper>;

  subscribe(
    queueNamePrefix: string,
    exchange: string,
    bindings: string[],
    handler: SubscribeHandler,
    options?: SubscribeOptions,
  ): Promise<ChannelWrapper>;

  plainChannel(
    exchange: string,
    exchangeType?: string,
    durable?: boolean,
  ): ChannelWrapper;

  publishChannel(
    exchange: string,
    exchangeType?: string,
    durable?: boolean,
  ): Promise<PublishFunction>;

  close(): Promise<void>;
}

export declare function createConnection(options: ConnectionOptions): AmqpConnection;
export declare function createConnection(name: string, options: ConnectionOptions): AmqpConnection;

export declare function getConnection(name: string): AmqpConnection;

export declare function isReachable(): Promise<boolean>;

export declare function workerQueue(
  queueName: string,
  exchange: string,
  bindings: string[],
  handler: WorkerQueueHandler,
  prefetch?: number,
): Promise<ChannelWrapper>;

export declare function subscribe(
  queueNamePrefix: string,
  exchange: string,
  bindings: string[],
  handler: SubscribeHandler,
  options?: SubscribeOptions,
): Promise<ChannelWrapper>;

export declare function plainChannel(
  exchange: string,
  exchangeType?: string,
  durable?: boolean,
): ChannelWrapper;

export declare function publishChannel(
  exchange: string,
  exchangeType?: string,
  durable?: boolean,
): Promise<PublishFunction>;

export declare const connectionManager: AmqpConnectionManager;

export declare function gracefulShutdown(): Promise<void>;

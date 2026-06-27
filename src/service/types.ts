import type { ServiceObject } from './object';
import type { RawMessage } from '@/message';
import type { Message } from '@/message-type';

export interface ServiceBus {
  send(msg: Message): void;
  readonly _serviceObjects: Record<string, ServiceObject | undefined>;
  _getServiceObject(path: string): ServiceObject;
  _introspect(path: string): string;
  readonly _connection: { message(msg: RawMessage): void };
  _serial: number;
}

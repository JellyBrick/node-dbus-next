import { MessageBus } from '@/bus';
import { createConnection } from '@/connection';
import {
  ACCESS_READ,
  ACCESS_WRITE,
  ACCESS_READWRITE,
  property,
  method,
  signal,
  Interface,
} from '@/service';

import type { ConnectionOptions } from '@/connection';

const createClient = (params: ConnectionOptions): MessageBus => {
  const connection = createConnection(params);
  return new MessageBus(connection);
};

/**
 * Create a new {@link MessageBus} client on the DBus system bus to connect to
 * interfaces or request service names. Connects to the socket specified by the
 * `DBUS_SYSTEM_BUS_ADDRESS` environment variable or
 * `unix:path=/var/run/dbus/system_bus_socket`.
 */
export const systemBus = (opts?: ConnectionOptions): MessageBus => {
  return createClient({
    ...opts,
    busAddress: process.env.DBUS_SYSTEM_BUS_ADDRESS || 'unix:path=/var/run/dbus/system_bus_socket',
  });
};

/**
 * Create a new {@link MessageBus} client on the DBus session bus to connect to
 * interfaces or request service names.
 */
export const sessionBus = (opts?: ConnectionOptions): MessageBus => {
  return createClient(opts ?? {});
};

export { setBigIntCompat } from '@/library-options';

export {
  NameFlag,
  RequestNameReply,
  ReleaseNameReply,
  MessageType,
  MessageFlag,
} from '@/constants';

export { Variant } from '@/variant';
export { Message } from '@/message-type';
export { DBusError } from '@/errors';
export { MessageBus } from '@/bus';

const interfaceNs = {
  ACCESS_READ,
  ACCESS_WRITE,
  ACCESS_READWRITE,
  property,
  method,
  signal,
  Interface,
};

export { interfaceNs as interface };

export * as validators from '@/validators';

export type { ClientInterface, ObjectPath, ProxyObject, ProxyInterface } from '@/client';
export type { ConnectionOptions, SessionBusOptions, SystemBusOptions } from '@/connection';
export type { AuthMethod } from '@/handshake';
export type { MessageLike } from '@/message-type';
export type {
  Interface,
  PropertyOptions,
  MethodOptions,
  SignalOptions,
  PropertyAccess,
} from '@/service';

import { Message } from '@/message-type';

import type { MessageBus } from '@/bus';
import type { ProxyInterface } from '@/client';

/**
 * Invoke a dynamically-installed proxy interface method. Proxy methods are
 * attached at runtime (from introspection), so they aren't on the
 * `ProxyInterface` type — this resolves and calls them, keeping the single
 * unavoidable cast in one place.
 */
export const call = <T = unknown>(
  iface: ProxyInterface,
  method: string,
  ...args: unknown[]
): Promise<T> => {
  const fn = (iface as unknown as Record<string, (...a: unknown[]) => Promise<T>>)[method];
  if (fn === undefined) {
    throw new Error(`proxy interface has no method '${method}'`);
  }
  return fn(...args);
};

/** Whether a dynamically-installed proxy method exists on the interface. */
export const hasMethod = (iface: ProxyInterface, method: string): boolean => {
  return typeof (iface as unknown as Record<string, unknown>)[method] === 'function';
};

export const ping = (bus: MessageBus) => {
  return bus.call(
    new Message({
      destination: 'org.freedesktop.DBus',
      path: '/org/freedesktop/DBus',
      interface: 'org.freedesktop.DBus.Peer',
      member: 'Ping',
    }),
  );
};

/**
 * Waits for a message that passes a filter on a provided bus.
 */
export const waitForMessage = (
  bus: MessageBus,
  messageFilter: Partial<Record<keyof Message, unknown>>,
): Promise<void> => {
  return new Promise((resolve) => {
    bus.on('message', (message: Message) => {
      const isMessageValid = Object.entries(messageFilter).every(
        ([key, value]) => message[key as keyof Message] === value,
      );

      if (isMessageValid) {
        resolve();
      }
    });
  });
};

import { afterAll, beforeAll, expect, test } from 'vitest';

import { Message, MessageType, sessionBus } from '@/index';

import type { MessageBus } from '@/bus';

const { SIGNAL } = MessageType;

const monitor = sessionBus();
const bus1 = sessionBus();
const bus2 = sessionBus();
const bus3 = sessionBus();

bus1.on('error', (err: Error) => {
  console.log(`bus1 got unexpected connection error:\n${err.stack ?? ''}`);
});
bus2.on('error', (err: Error) => {
  console.log(`bus2 got unexpected connection error:\n${err.stack ?? ''}`);
});
bus3.on('error', (err: Error) => {
  console.log(`bus3 got unexpected connection error:\n${err.stack ?? ''}`);
});
monitor.on('error', (err: Error) => {
  console.log(`monitor bus got unexpected connection error:\n${err.stack ?? ''}`);
});

beforeAll(async () => {
  const connect = [bus1, bus2, bus3, monitor].map((bus) => {
    return new Promise<void>((resolve) => {
      bus.on('connect', () => {
        resolve();
      });
    });
  });

  await Promise.all(connect);

  await monitor.call(
    new Message({
      destination: 'org.freedesktop.DBus',
      path: '/org/freedesktop/DBus',
      interface: 'org.freedesktop.DBus.Monitoring',
      member: 'BecomeMonitor',
      signature: 'asu',
      body: [[`sender=${bus1.name ?? ''}`, `sender=${bus2.name ?? ''}`], 0],
    }),
  );
});

afterAll(() => {
  bus1.disconnect();
  bus2.disconnect();
  bus3.disconnect();
  monitor.disconnect();
});

const waitForMessage = (bus: MessageBus): Promise<Message> => {
  return new Promise((resolve) => {
    bus.once('message', (msg: Message) => {
      resolve(msg);
    });
  });
};

test('monitor a signal', async () => {
  const signal = Message.newSignal('/org/test/path', 'org.test.interface', 'SomeSignal', 's', [
    'a signal',
  ]);
  bus1.send(signal);
  const msg = await waitForMessage(monitor);
  expect(msg.type).toEqual(SIGNAL);
  expect(msg.sender).toEqual(bus1.name);
  expect(msg.serial).toEqual(signal.serial);
});

test('monitor a method call', async () => {
  const messages: Message[] = [];
  const monitorHandler = (message: Message): void => {
    messages.push(message);
  };
  monitor.on('message', monitorHandler);

  const messageHandler = (sent: Message): boolean => {
    bus1.send(Message.newMethodReturn(sent, 's', ['got it']));
    return true;
  };

  bus1.addMethodHandler(messageHandler);

  await bus2.call(
    new Message({
      destination: bus1.name ?? undefined,
      path: '/org/test/path',
      interface: 'org.test.interface',
      member: 'TestMethod',
      signature: 's',
      body: ['hello'],
    }),
  );

  await bus3.call(
    new Message({
      destination: 'org.freedesktop.DBus',
      path: '/org/freedesktop/DBus',
      interface: 'org.freedesktop.DBus.Peer',
      member: 'Ping',
    }),
  );

  expect(messages.length).toEqual(2);
  expect(messages[0]?.sender).toEqual(bus2.name);
  expect(messages[1]?.sender).toEqual(bus1.name);
  monitor.removeListener('message', monitorHandler);
});

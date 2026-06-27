import { afterAll, beforeAll, expect, test } from 'vitest';

import { DBusError, Message, MessageFlag, MessageType, sessionBus } from '@/index';

const { METHOD_CALL, METHOD_RETURN, SIGNAL, ERROR } = MessageType;
const { NO_REPLY_EXPECTED } = MessageFlag;

const bus1 = sessionBus();
const bus2 = sessionBus();

bus1.on('error', (err: Error) => {
  console.log(`bus1 got unexpected connection error:\n${err.stack ?? ''}`);
});
bus2.on('error', (err: Error) => {
  console.log(`bus2 got unexpected connection error:\n${err.stack ?? ''}`);
});

beforeAll(async () => {
  const connect = [bus1, bus2].map((bus) => {
    return new Promise<void>((resolve) => {
      bus.on('connect', () => {
        resolve();
      });
    });
  });

  await Promise.all(connect);
});

afterAll(() => {
  bus1.disconnect();
  bus2.disconnect();
});

test('send a method call between buses', async () => {
  const msg = new Message({
    destination: bus1.name ?? undefined,
    path: '/org/test/path',
    interface: 'org.test.iface',
    member: 'SomeMember',
  });

  const methodReturnHandler = (sent: Message): boolean => {
    if (sent.serial === msg.serial) {
      expect(sent.path).toEqual(msg.path);
      expect(sent.serial).toEqual(msg.serial);
      expect(sent.interface).toEqual(msg.interface);
      expect(sent.member).toEqual(msg.member);

      bus1.send(Message.newMethodReturn(sent, 's', ['got it']));
      bus1.removeMethodHandler(methodReturnHandler);
      return true;
    }
    return false;
  };
  bus1.addMethodHandler(methodReturnHandler);
  expect(bus1._methodHandlers.length).toEqual(1);

  let reply = await bus2.call(msg);

  expect(bus1._methodHandlers.length).toEqual(0);
  expect(reply?.type).toEqual(METHOD_RETURN);
  expect(reply?.sender).toEqual(bus1.name);
  expect(reply?.signature).toEqual('s');
  expect(reply?.body).toEqual(['got it']);
  expect(reply?.replySerial).toEqual(msg.serial);

  const errorReturnHandler = (sent: Message): boolean => {
    if (sent.serial === msg.serial) {
      expect(sent.type).toEqual(METHOD_CALL);
      expect(sent.path).toEqual(msg.path);
      expect(sent.serial).toEqual(msg.serial);
      expect(sent.interface).toEqual(msg.interface);
      expect(sent.member).toEqual(msg.member);

      bus1.send(Message.newError(sent, 'org.test.Error', 'throwing an error'));
      bus1.removeMethodHandler(errorReturnHandler);
      return true;
    }
    return false;
  };

  bus1.addMethodHandler(errorReturnHandler);
  let caught: unknown;
  try {
    // sending the same message twice should reset the serial
    await bus2.call(msg);
  } catch (e) {
    caught = e;
  }

  expect(caught).toBeInstanceOf(DBusError);
  const error = caught as DBusError;
  const errorReply = error.reply as Message;
  expect(errorReply).toBeInstanceOf(Message);
  expect(errorReply.type).toEqual(ERROR);
  expect(errorReply.sender).toEqual(bus1.name);
  expect(errorReply.errorName).toEqual('org.test.Error');
  expect(errorReply.signature).toEqual('s');
  expect(errorReply.replySerial).toEqual(msg.serial);
  expect(errorReply.body).toEqual(['throwing an error']);

  expect(error.type).toEqual('org.test.Error');
  expect(error.message).toEqual('throwing an error');

  // with no reply expected
  const waitForReply = new Promise<Message>((resolve) => {
    bus1.once('message', (received: Message) => {
      if (received.sender === bus2.name) {
        resolve(received);
      }
    });
  });

  msg.flags = NO_REPLY_EXPECTED;
  const result = await bus2.call(msg);
  expect(result).toBeNull();
  reply = await waitForReply;
  expect(reply).toBeInstanceOf(Message);
});

test('send a signal between buses', async () => {
  const addMatchMessage = new Message({
    destination: 'org.freedesktop.DBus',
    path: '/org/freedesktop/DBus',
    interface: 'org.freedesktop.DBus',
    member: 'AddMatch',
    signature: 's',
    body: [`sender='${bus2.name ?? ''}'`],
  });
  await bus1.call(addMatchMessage);

  const waitForSignal = new Promise<Message>((resolve) => {
    bus1.once('message', (msg: Message) => {
      if (msg.sender === bus2.name) {
        resolve(msg);
      }
    });
  });

  bus2.send(
    Message.newSignal('/org/test/path', 'org.test.interface', 'SomeSignal', 's', ['a signal']),
  );
  const signal = await waitForSignal;

  expect(signal.type).toEqual(SIGNAL);
  expect(signal.path).toEqual('/org/test/path');
  expect(signal.interface).toEqual('org.test.interface');
  expect(signal.member).toEqual('SomeSignal');
  expect(signal.signature).toEqual('s');
  expect(signal.body).toEqual(['a signal']);
});

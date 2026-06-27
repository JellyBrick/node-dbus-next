// Test the ability to send and recv file descriptors in dbus messages.
//
// These tests require a bus connection that supports UNIX fd passing (Linux).

import { close, fstat, open } from 'node:fs';

import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';

import { Message, MessageType, sessionBus, Variant } from '@/index';
import {
  ACCESS_READ,
  ACCESS_WRITE,
  Interface,
  method,
  property,
  signal,
} from '@/service/interface';

import { call, hasMethod } from '../util';

import type { Stats } from 'node:fs';

const { METHOD_RETURN } = MessageType;

const TEST_NAME = 'org.test.filedescriptors';
const TEST_PATH = '/org/test/path';
const TEST_IFACE = 'org.test.iface';

const bus = sessionBus({ negotiateUnixFd: true });
bus.on('error', (err: Error) => {
  console.log(`got unexpected connection error:\n${err.stack ?? ''}`);
});

const bus2 = sessionBus({ negotiateUnixFd: true });
bus2.on('error', (err: Error) => {
  console.log(`got unexpected connection error:\n${err.stack ?? ''}`);
});

const openFd = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    open('/dev/null', 'r', (err, fd) => {
      if (err) reject(err);
      else resolve(fd);
    });
  });
};

const closeFd = (fd: number): Promise<void> => {
  return new Promise((resolve, reject) => {
    close(fd, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const statFd = (fd: number): Promise<Stats> => {
  return new Promise((resolve, reject) => {
    fstat(fd, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
};

const compareFd = async (fd1: number | undefined, fd2: number | undefined): Promise<void> => {
  expect(fd1).toBeDefined();
  expect(fd2).toBeDefined();
  const s1 = await statFd(fd1 as number);
  const s2 = await statFd(fd2 as number);
  expect(s1.ino).toEqual(s2.ino);
  expect(s1.dev).toEqual(s2.dev);
  expect(s1.rdev).toEqual(s2.rdev);
};

class TestInterface extends Interface {
  fds: number[];

  constructor(name: string) {
    super(name);
    this.fds = [];
  }

  @method({ outSignature: 'h' })
  returnsFd(): Promise<number> {
    return this.createFd();
  }

  @method({ inSignature: 'h' })
  acceptsFd(fd: number): void {
    this.fds.push(fd);
  }

  @property({ signature: 'h', access: ACCESS_READ })
  get getFdProp(): number | undefined {
    return this.getLastFd();
  }

  @property({ signature: 'h', access: ACCESS_WRITE })
  set setFdProp(fd: number) {
    this.fds.push(fd);
  }

  @signal({ signature: 'h' })
  signalFd(fd: number): number {
    return fd;
  }

  getLastFd(): number | undefined {
    return this.fds[this.fds.length - 1];
  }

  @method({})
  async emitSignal(): Promise<void> {
    const fd = await this.createFd();
    this.signalFd(fd);
  }

  async createFd(): Promise<number> {
    const fd = await openFd();
    this.fds.push(fd);
    return fd;
  }

  async cleanup(): Promise<void> {
    while (this.fds.length > 0) {
      const fd = this.fds.pop();
      if (fd !== undefined) {
        await closeFd(fd);
      }
    }
  }
}

const testIface = new TestInterface(TEST_IFACE);

beforeAll(async () => {
  await bus2.requestName(TEST_NAME);
  bus2.export(TEST_PATH, testIface);
});

afterEach(async () => {
  await testIface.cleanup();
});

afterAll(() => {
  bus.disconnect();
  bus2.disconnect();
});

test('sending file descriptor', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const iface = object.getInterface(TEST_IFACE);
  expect(hasMethod(iface, 'returnsFd')).toBe(true);
  const fd = await openFd();
  await call(iface, 'acceptsFd', fd);

  expect(testIface.getLastFd()).toBeDefined();
  await compareFd(fd, testIface.getLastFd());
  await closeFd(fd);
});

test('receiving file descriptor', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const iface = object.getInterface(TEST_IFACE);
  expect(hasMethod(iface, 'returnsFd')).toBe(true);
  const fd = (await call(iface, 'returnsFd')) as number;
  expect(fd).toBeDefined();

  await compareFd(fd, testIface.getLastFd());
  await closeFd(fd);
});

test('get file descriptor property', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const properties = object.getInterface('org.freedesktop.DBus.Properties');
  expect(hasMethod(properties, 'Get')).toBe(true);
  await testIface.createFd();
  const fdVariant = (await call(properties, 'Get', TEST_IFACE, 'getFdProp')) as Variant;
  expect(fdVariant.signature).toEqual('h');
  expect(fdVariant.value).toBeDefined();

  await compareFd(fdVariant.value as number, testIface.getLastFd());
  await closeFd(fdVariant.value as number);
});

test('set file descriptor property', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const properties = object.getInterface('org.freedesktop.DBus.Properties');
  expect(hasMethod(properties, 'Set')).toBe(true);
  const fd = await openFd();
  await call(properties, 'Set', TEST_IFACE, 'setFdProp', new Variant('h', fd));

  expect(testIface.getLastFd()).toBeDefined();
  await compareFd(fd, testIface.getLastFd());
  await closeFd(fd);
});

test('signal file descriptor', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const iface = object.getInterface(TEST_IFACE);

  let fd: number | undefined;
  const onSignal = vi.fn((fd_: number) => {
    fd = fd_;
  });
  iface.on('signalFd', onSignal);

  await call(iface, 'emitSignal');

  expect(onSignal).toHaveBeenCalled();

  await compareFd(fd, testIface.getLastFd());
  if (fd !== undefined) {
    await closeFd(fd);
  }
});

test('low level file descriptor sending', async () => {
  const fd = await openFd();
  const msg = new Message({
    destination: bus.name ?? undefined,
    path: '/org/test/path',
    interface: 'org.test.iface',
    member: 'SomeMember',
    signature: 'h',
    body: [fd],
  });

  const methodReturnHandler = (sent: Message): boolean => {
    if (sent.serial === msg.serial) {
      expect(sent.path).toEqual(msg.path);
      expect(sent.serial).toEqual(msg.serial);
      expect(sent.interface).toEqual(msg.interface);
      expect(sent.member).toEqual(msg.member);
      expect(sent.signature).toEqual('h');
      const sentFd = sent.body[0] as number;
      compareFd(sentFd, fd)
        .then(() => closeFd(sentFd))
        .then(() => {
          bus.send(Message.newMethodReturn(sent, 's', ['got it']));
        })
        .catch(() => {});

      bus.removeMethodHandler(methodReturnHandler);
      return true;
    }
    return false;
  };
  bus.addMethodHandler(methodReturnHandler);
  expect(bus._methodHandlers.length).toEqual(1);

  const reply = await bus2.call(msg);

  expect(bus._methodHandlers.length).toEqual(0);
  expect(reply?.type).toEqual(METHOD_RETURN);
  expect(reply?.sender).toEqual(bus.name);
  expect(reply?.signature).toEqual('s');
  expect(reply?.body).toEqual(['got it']);
  expect(reply?.replySerial).toEqual(msg.serial);

  await closeFd(fd);
});

test('low level file descriptor receiving', async () => {
  const fd = await openFd();
  const msg = new Message({
    destination: bus.name ?? undefined,
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
      bus.send(Message.newMethodReturn(sent, 'h', [fd]));
      bus.removeMethodHandler(methodReturnHandler);
      return true;
    }
    return false;
  };
  bus.addMethodHandler(methodReturnHandler);
  expect(bus._methodHandlers.length).toEqual(1);

  const reply = await bus2.call(msg);

  expect(bus._methodHandlers.length).toEqual(0);
  expect(reply?.type).toEqual(METHOD_RETURN);
  expect(reply?.sender).toEqual(bus.name);
  expect(reply?.signature).toEqual('h');
  expect(reply?.replySerial).toEqual(msg.serial);
  await compareFd(fd, reply?.body?.[0] as number);

  await closeFd(fd);
  await closeFd(reply?.body?.[0] as number);
});

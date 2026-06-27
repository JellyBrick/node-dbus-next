// Test when services throw errors

import { afterAll, beforeAll, expect, test } from 'vitest';

import { DBusError, sessionBus, Variant } from '@/index';
import { Interface, method, property } from '@/service/interface';

import { call } from '../util';

const TEST_NAME = 'org.test.service_errors';
const TEST_PATH = '/org/test/path';
const TEST_IFACE = 'org.test.iface';

const bus = sessionBus();
bus.on('error', (err: Error) => {
  console.log(`got unexpected connection error:\n${err.stack ?? ''}`);
});

class ErroringInterface extends Interface {
  @property({ signature: 's' })
  get ErrorProperty(): string {
    throw new Error('something went wrong');
  }

  set ErrorProperty(_val: string) {
    throw new Error('something went wrong');
  }

  @property({ signature: 's' })
  WrongType = 55;

  @method({})
  ErrorMethod(): void {
    throw new Error('something went wrong');
  }

  @method({})
  WrongReturn(): string[] {
    return ['foo', 'bar'];
  }
}

const testIface = new ErroringInterface(TEST_IFACE);

beforeAll(async () => {
  await bus.requestName(TEST_NAME);
  bus.export(TEST_PATH, testIface);
});

afterAll(() => {
  bus.disconnect();
});

test('when services throw errors they should be returned to the client', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const properties = object.getInterface('org.freedesktop.DBus.Properties');
  const iface = object.getInterface(TEST_IFACE);

  await expect(call(iface, 'ErrorMethod')).rejects.toThrow(DBusError);
  await expect(call(iface, 'WrongReturn')).rejects.toThrow(DBusError);
  await expect(call(properties, 'GetAll', TEST_IFACE)).rejects.toThrow(DBusError);
  await expect(call(properties, 'Get', TEST_IFACE, 'ErrorProperty')).rejects.toThrow(DBusError);
  await expect(call(properties, 'Get', TEST_IFACE, 'WrongType')).rejects.toThrow(DBusError);
  await expect(
    call(properties, 'Set', TEST_IFACE, 'ErrorProperty', new Variant('s', 'something')),
  ).rejects.toThrow(DBusError);
});

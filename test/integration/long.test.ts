// Test that methods and properties of type 'x' (long int) work correctly

import { afterAll, beforeAll, expect, test } from 'vitest';

import { _getBigIntConstants } from '@/constants';
import { DBusError, sessionBus } from '@/index';
import { Interface, method } from '@/service/interface';

import { call } from '../util';

const TEST_NAME = 'org.test.long';
const TEST_PATH = '/org/test/path';
const TEST_IFACE = 'org.test.iface';
const TEST_ERROR_PATH = 'org.test.name.error';

const bus = sessionBus();
bus.on('error', (err: Error) => {
  console.log(`got unexpected connection error:\n${err.stack ?? ''}`);
});

class LongInterface extends Interface {
  @method({ inSignature: 'x', outSignature: 'x' })
  EchoSigned(what: unknown): bigint {
    if (typeof what !== 'bigint') {
      throw new DBusError(TEST_ERROR_PATH, 'interface with long expected a BigInt for type x');
    }
    return what;
  }

  @method({ inSignature: 't', outSignature: 't' })
  EchoUnsigned(what: unknown): bigint {
    if (typeof what !== 'bigint') {
      throw new DBusError(TEST_ERROR_PATH, 'interface with long expected a BigInt for type t');
    }
    return what;
  }
}

const testIface = new LongInterface(TEST_IFACE);

beforeAll(async () => {
  await bus.requestName(TEST_NAME);
  bus.export(TEST_PATH, testIface);
});

afterAll(() => {
  bus.disconnect();
});

test('test long type works correctly', async () => {
  const { MAX_INT64, MIN_INT64, MAX_UINT64, MIN_UINT64 } = _getBigIntConstants();

  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const iface = object.getInterface(TEST_IFACE);

  // small numbers
  let what = BigInt(-30);
  let result = await call(iface, 'EchoSigned', what);
  expect(result === what).toEqual(true);

  what = BigInt(30);
  result = await call(iface, 'EchoUnsigned', what);
  expect(result === what).toEqual(true);
  result = await call(iface, 'EchoSigned', what);
  expect(result === what).toEqual(true);

  // int64 max
  what = MAX_INT64;
  result = await call(iface, 'EchoSigned', what);
  expect(result === what).toEqual(true);

  await expect(call(iface, 'EchoSigned', what + BigInt(1))).rejects.toThrow();

  // int64 min
  what = MIN_INT64;
  result = await call(iface, 'EchoSigned', what);
  expect(result === what).toEqual(true);

  await expect(call(iface, 'EchoSigned', what - BigInt(1))).rejects.toThrow();

  // uint64 max
  what = MAX_UINT64;
  result = await call(iface, 'EchoUnsigned', what);
  expect(result === what).toEqual(true);

  await expect(call(iface, 'EchoUnsigned', what + BigInt(1))).rejects.toThrow();

  // uint64 min
  what = MIN_UINT64;
  result = await call(iface, 'EchoUnsigned', what);
  expect(result === what).toEqual(true);

  await expect(call(iface, 'EchoUnsigned', what - BigInt(1))).rejects.toThrow();
});

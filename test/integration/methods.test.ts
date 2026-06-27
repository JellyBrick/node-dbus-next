// Test that interface methods work correctly

import { afterAll, beforeAll, expect, test } from 'vitest';

import { DBusError, sessionBus, Variant } from '@/index';
import { Interface, method } from '@/service/interface';

import { call } from '../util';

const TEST_NAME = 'org.test.methods';
const TEST_PATH = '/org/test/path';
const TEST_IFACE = 'org.test.iface';

const bus = sessionBus();
bus.on('error', (err: Error) => {
  console.log(`got unexpected connection error:\n${err.stack ?? ''}`);
});

class MethodsInterface extends Interface {
  expectedError(): DBusError {
    return new DBusError('org.test.iface.Error', 'something went wrong');
  }

  @method({ inSignature: 'v', outSignature: 'v' })
  Echo(what: Variant): Variant {
    return what;
  }

  @method({ inSignature: 'vv', outSignature: 'vv' })
  EchoMultiple(what: Variant, what2: Variant): Variant[] {
    return [what, what2];
  }

  @method({ inSignature: '', outSignature: '' })
  ThrowsError(): void {
    throw this.expectedError();
  }

  complicated1 = [
    new Variant('s', 'foo'),
    new Variant('(s(sv))', [
      'bar',
      ['bat', new Variant('av', [new Variant('s', 'baz'), new Variant('i', 53)])],
    ]),
  ];

  complicated2 = ['one', 'two'];

  @method({ inSignature: '', outSignature: 'av(ss)' })
  ReturnsComplicated(): [Variant[], string[]] {
    return [this.complicated1, this.complicated2];
  }

  @method({ inSignature: 'as', outSignature: '' })
  TakesList(_what: string[]): void {}

  @method({ inSignature: 's', outSignature: 's' })
  AsyncEcho(what: string): Promise<string> {
    return Promise.resolve(what);
  }

  @method({ inSignature: '', outSignature: '' })
  AsyncError(): Promise<void> {
    return Promise.reject(this.expectedError());
  }
}

const testIface = new MethodsInterface(TEST_IFACE);

beforeAll(async () => {
  await bus.requestName(TEST_NAME);
  bus.export(TEST_PATH, testIface);
});

afterAll(() => {
  bus.disconnect();
});

// a really complicated variant
const echoVariant = new Variant('a{sv}', {
  foo: new Variant('s', 'bar'),
  bar: new Variant('d', 53),
  bat: new Variant('v', new Variant('as', ['foo', 'bar', 'bat'])),
  baz: new Variant('(doodoo)', [1, '/', '/', 1, '/', '/']),
  fiz: new Variant('(as(s(v)))', [
    ['one', 'two'],
    ['three', [new Variant('as', ['four', 'five'])]],
  ]),
  kevin: new Variant('(vs)', [new Variant('s', 'foo'), 'foo']),
  buz: new Variant('av', [
    new Variant('as', ['foo']),
    new Variant('a{ss}', { foo: 'bar' }),
    new Variant('v', new Variant('(asas)', [['bar'], ['foo']])),
    new Variant('v', new Variant('v', new Variant('as', ['one', 'two']))),
    new Variant('a{ss}', { foo: 'bar' }),
  ]),
});

test('that methods work correctly', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const iface = object.getInterface(TEST_IFACE);

  const result = await call(iface, 'Echo', echoVariant);
  expect(result).toEqual(echoVariant);

  let [r1, r2] = (await call(iface, 'EchoMultiple', echoVariant, echoVariant)) as unknown[];
  expect(r1).toEqual(echoVariant);
  expect(r2).toEqual(echoVariant);

  [r1, r2] = (await call(iface, 'ReturnsComplicated')) as unknown[];
  expect(r1).toEqual(testIface.complicated1);
  expect(r2).toEqual(testIface.complicated2);

  await expect(call(iface, 'ThrowsError')).rejects.toEqual(testIface.expectedError());

  const asyncEcho = await call(iface, 'AsyncEcho', 'what');
  expect(asyncEcho).toEqual('what');

  await expect(call(iface, 'AsyncError')).rejects.toEqual(testIface.expectedError());
});

test('client method errors', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const iface = object.getInterface(TEST_IFACE);

  await expect(call(iface, 'Echo', 'wrong type')).rejects.toBeInstanceOf(Error);
  await expect(call(iface, 'TakesList', 'wrong type')).rejects.toBeInstanceOf(Error);
  await expect(call(iface, 'TakesList')).rejects.toBeInstanceOf(Error);
  await expect(call(iface, 'Echo', new Variant('as', 'wrong type'))).rejects.toBeInstanceOf(Error);
});

// Test service option features

import { afterAll, beforeAll, expect, test, vi } from 'vitest';

import { DBusError, sessionBus, Variant } from '@/index';
import { Interface, method, property, signal } from '@/service/interface';

import { call } from '../util';

const TEST_NAME = 'org.test.service_options';
const TEST_PATH = '/org/test/path';
const TEST_IFACE = 'org.test.iface';

const bus = sessionBus();
bus.on('error', (err: Error) => {
  console.log(`got unexpected connection error:\n${err.stack ?? ''}`);
});

class OptionsTestInterface extends Interface {
  @method({ disabled: true })
  DisabledMethod(): void {}

  @method({ name: 'SomeMethod', inSignature: 's', outSignature: 's' })
  methodNamedDifferently(what: string): string {
    return what;
  }

  @signal({ name: 'RenamedSignal', signature: 's' })
  signalNamedDifferently(what: string): string {
    return what;
  }

  @method({})
  EmitRenamedSignal(): void {
    this.signalNamedDifferently('hello');
  }

  @signal({ disabled: true, signature: 'd' })
  DisabledSignal(what: number): number {
    return what;
  }

  @property({ name: 'SomeProperty', signature: 's' })
  propertyNamedDifferently = 'SomeProperty';

  @property({ disabled: true, signature: 's' })
  DisabledProperty = 'DisabledProperty';
}

const testIface = new OptionsTestInterface(TEST_IFACE);

beforeAll(async () => {
  await bus.requestName(TEST_NAME);
  bus.export(TEST_PATH, testIface);
});

afterAll(() => {
  bus.disconnect();
});

test('renamed and disabled property requests', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const properties = object.getInterface('org.freedesktop.DBus.Properties');

  const all = await call(properties, 'GetAll', TEST_IFACE);
  // this property was renamed
  expect(all).not.toHaveProperty('propertyNamedDifferently');
  // this property is disabled
  expect(all).not.toHaveProperty('DisabledProperty');
  // the renamed one should show up
  expect(all).toHaveProperty('SomeProperty');

  await expect(call(properties, 'Get', TEST_IFACE, 'propertyNamedDifferently')).rejects.toThrow(
    DBusError,
  );
  await expect(call(properties, 'Get', TEST_IFACE, 'DisabledProperty')).rejects.toThrow(DBusError);
  await expect(call(properties, 'Get', TEST_IFACE, 'SomeProperty')).resolves.toEqual(
    new Variant('s', testIface.propertyNamedDifferently),
  );

  await expect(
    call(
      properties,
      'Set',
      TEST_IFACE,
      'propertyNamedDifferently',
      new Variant('s', testIface.propertyNamedDifferently),
    ),
  ).rejects.toThrow(DBusError);
  await expect(
    call(properties, 'Set', TEST_IFACE, 'DisabledProperty', new Variant('s', 'disabled')),
  ).rejects.toThrow(DBusError);
  await expect(
    call(
      properties,
      'Set',
      TEST_IFACE,
      'SomeProperty',
      new Variant('s', testIface.propertyNamedDifferently),
    ),
  ).resolves.toEqual(null);
});

test('renamed and disabled methods', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const iface = object.getInterface(TEST_IFACE);

  expect(iface).not.toHaveProperty('DisabledMethod');
  expect(iface).not.toHaveProperty('methodNamedDifferently');
  expect(iface).toHaveProperty('SomeMethod');
  const testStr = 'what';
  await expect(call(iface, 'SomeMethod', testStr)).resolves.toEqual(testStr);
});

test('renamed and disabled signals', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const iface = object.getInterface(TEST_IFACE);

  const onRenamedSignal = vi.fn(() => {});
  iface.on('RenamedSignal', onRenamedSignal);

  await call(iface, 'EmitRenamedSignal');

  expect(onRenamedSignal).toHaveBeenCalledWith('hello');
});

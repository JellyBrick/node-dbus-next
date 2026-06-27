// Test the server properties interface works correctly.

import { afterAll, beforeAll, expect, test, vi } from 'vitest';

import { DBusError, sessionBus, Variant } from '@/index';
import { ACCESS_READ, ACCESS_WRITE, Interface, property } from '@/service/interface';

import { call, hasMethod } from '../util';

const TEST_NAME = 'org.test.properties';
const TEST_PATH = '/org/test/path';
const TEST_IFACE = 'org.test.iface';
const USER_ERROR_IFACE = 'org.test.usererror';

const bus = sessionBus();
bus.on('error', (err: Error) => {
  console.log(`got unexpected connection error:\n${err.stack ?? ''}`);
});

class UserErrorInterface extends Interface {
  @property({ signature: 's' })
  get UserErrorProperty(): string {
    throw new DBusError(`${TEST_IFACE}.UserError`, 'user error');
  }

  set UserErrorProperty(_what: string) {
    throw new DBusError(`${TEST_IFACE}.UserError`, 'user error');
  }
}

class TestInterface extends Interface {
  @property({ signature: 's' })
  SimpleProperty = 'foo';

  @property({ signature: 'v' })
  VariantProperty = new Variant('s', 'foo');

  @property({ signature: '(a{sv}sv)' })
  ComplicatedProperty = [
    {
      foo: new Variant('s', 'bar'),
      bar: new Variant('as', ['fiz', 'buz']),
    },
    'bat',
    new Variant('d', 53),
  ];

  _NotifyingProperty = 'foo';

  @property({ signature: 's' })
  get NotifyingProperty(): string {
    return this._NotifyingProperty;
  }

  set NotifyingProperty(value: string) {
    this._NotifyingProperty = value;
    Interface.emitPropertiesChanged(
      this,
      {
        NotifyingProperty: value,
      },
      ['invalid'],
    );
  }

  @property({ signature: 's', access: ACCESS_READ })
  ReadOnly = 'only read';

  @property({ signature: 's', access: ACCESS_WRITE })
  WriteOnly = 'only write';
}

const testIface = new TestInterface(TEST_IFACE);
const userErrorIface = new UserErrorInterface(USER_ERROR_IFACE);

beforeAll(async () => {
  await bus.requestName(TEST_NAME);
  bus.export(TEST_PATH, testIface);
  bus.export(TEST_PATH, userErrorIface);
});

afterAll(() => {
  bus.disconnect();
});

test('the peer interface', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const peer = object.getInterface('org.freedesktop.DBus.Peer');
  expect(hasMethod(peer, 'Ping')).toBe(true);
  await expect(call(peer, 'Ping')).resolves.toBeNull();
  await expect(call(peer, 'GetMachineId')).resolves.toBeDefined();
});

test('simple property get and set', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);

  const iface = object.getInterface(TEST_IFACE);
  expect(iface).toBeDefined();
  const properties = object.getInterface('org.freedesktop.DBus.Properties');

  // get and set a simple property
  let prop = (await call(properties, 'Get', TEST_IFACE, 'SimpleProperty')) as Variant;
  expect(prop).toBeInstanceOf(Variant);
  expect(prop.signature).toEqual('s');
  expect(prop.value).toEqual('foo');
  expect(prop.value).toEqual(testIface.SimpleProperty);

  await call(properties, 'Set', TEST_IFACE, 'SimpleProperty', new Variant('s', 'bar'));

  prop = (await call(properties, 'Get', TEST_IFACE, 'SimpleProperty')) as Variant;
  expect(prop).toBeInstanceOf(Variant);
  expect(prop.value).toEqual('bar');
  expect(prop.value).toEqual(testIface.SimpleProperty);

  // get and set a variant property
  prop = (await call(properties, 'Get', TEST_IFACE, 'VariantProperty')) as Variant;
  expect(prop.value).toBeInstanceOf(Variant);
  expect(prop.value).toEqual(testIface.VariantProperty);

  await call(
    properties,
    'Set',
    TEST_IFACE,
    'VariantProperty',
    new Variant('v', new Variant('d', 53)),
  );
  prop = (await call(properties, 'Get', TEST_IFACE, 'VariantProperty')) as Variant;
  expect(prop).toBeInstanceOf(Variant);
  expect(prop.value).toEqual(new Variant('d', 53));
  expect(prop.value).toEqual(testIface.VariantProperty);

  // test get all properties
  const all = await call(properties, 'GetAll', TEST_IFACE);
  expect(all).toHaveProperty('SimpleProperty', new Variant('s', testIface.SimpleProperty));
  expect(all).toHaveProperty('VariantProperty', new Variant('v', testIface.VariantProperty));
});

test('complicated property get and set', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const properties = object.getInterface('org.freedesktop.DBus.Properties');
  let prop = (await call(properties, 'Get', TEST_IFACE, 'ComplicatedProperty')) as Variant;
  expect(prop).toBeInstanceOf(Variant);
  expect(prop.value).toEqual(testIface.ComplicatedProperty);

  const updatedProp = [
    {
      oof: new Variant('s', 'rab'),
      rab: new Variant('as', ['zif', 'zub', 'zork']),
      kevin: new Variant('a{sv}', {
        foo: new Variant('s', 'bar'),
      }),
    },
    'tab',
    new Variant('d', 23),
  ];

  await call(
    properties,
    'Set',
    TEST_IFACE,
    'ComplicatedProperty',
    new Variant('(a{sv}sv)', updatedProp),
  );
  prop = (await call(properties, 'Get', TEST_IFACE, 'ComplicatedProperty')) as Variant;
  expect(prop).toBeInstanceOf(Variant);
  expect(prop.value).toEqual(testIface.ComplicatedProperty);
  expect(prop.value).toEqual(updatedProp);
});

test('properties changed signal', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const properties = object.getInterface('org.freedesktop.DBus.Properties');
  const onPropertiesChanged = vi.fn();
  properties.on('PropertiesChanged', onPropertiesChanged);

  await call(properties, 'Set', TEST_IFACE, 'NotifyingProperty', new Variant('s', 'bar'));
  const e = {
    NotifyingProperty: new Variant('s', 'bar'),
  };
  expect(onPropertiesChanged).toHaveBeenCalledWith(TEST_IFACE, e, ['invalid']);
});

test('read and write access', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const properties = object.getInterface('org.freedesktop.DBus.Properties');

  await expect(call(properties, 'Get', TEST_IFACE, 'WriteOnly')).rejects.toBeInstanceOf(DBusError);
  await expect(
    call(properties, 'Set', TEST_IFACE, 'ReadOnly', new Variant('s', 'foo')),
  ).rejects.toBeInstanceOf(DBusError);
});

test('properties interface specific errors', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const properties = object.getInterface('org.freedesktop.DBus.Properties');

  await expect(
    call(properties, 'Set', 'not.an.interface', 'ReadOnly', new Variant('s', 'foo')),
  ).rejects.toBeInstanceOf(DBusError);
  await expect(call(properties, 'Get', TEST_IFACE, 'NotAProperty')).rejects.toBeInstanceOf(
    DBusError,
  );
  await expect(
    call(properties, 'Set', TEST_IFACE, 'NotAProperty', new Variant('s', 'foo')),
  ).rejects.toBeInstanceOf(DBusError);
  await expect(
    call(properties, 'Set', TEST_IFACE, 'WriteOnly', new Variant('as', ['wrong', 'type'])),
  ).rejects.toBeInstanceOf(DBusError);

  // user errors
  await expect(
    call(properties, 'Get', USER_ERROR_IFACE, 'UserErrorProperty'),
  ).rejects.toBeInstanceOf(DBusError);
  await expect(
    call(properties, 'Set', USER_ERROR_IFACE, 'UserErrorProperty', new Variant('s', 'foo')),
  ).rejects.toBeInstanceOf(DBusError);
  await expect(call(properties, 'GetAll', USER_ERROR_IFACE)).rejects.toBeInstanceOf(DBusError);
});

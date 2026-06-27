// Test a service configured with Interface.configureMembers()

import { afterAll, beforeAll, expect, test, vi } from 'vitest';

import { sessionBus, Variant } from '@/index';
import { Interface } from '@/service/interface';

import { call } from '../util';

const TEST_NAME = 'org.test.configured_service';
const TEST_PATH = '/org/test/path';
const TEST_IFACE = 'org.test.iface';

const bus = sessionBus();
bus.on('error', (err: Error) => {
  console.log(`got unexpected connection error:\n${err.stack ?? ''}`);
});

class ConfiguredTestInterface extends Interface {
  _someProperty: string;

  constructor(name: string) {
    super(name);
    this._someProperty = 'foo';
  }

  get SomeProperty(): string {
    return this._someProperty;
  }

  set SomeProperty(value: string) {
    this._someProperty = value;
  }

  Echo(what: Variant): Variant {
    return what;
  }

  HelloWorld(): string[] {
    return ['hello', 'world'];
  }

  EmitSignals(): void {
    this.HelloWorld();
  }
}

ConfiguredTestInterface.configureMembers({
  properties: {
    SomeProperty: { signature: 's' },
  },
  methods: {
    Echo: { inSignature: 'v', outSignature: 'v' },
    EmitSignals: {},
  },
  signals: {
    HelloWorld: { signature: 'ss' },
  },
});

const testIface = new ConfiguredTestInterface(TEST_IFACE);

beforeAll(async () => {
  await bus.requestName(TEST_NAME);
  bus.export(TEST_PATH, testIface);
});

afterAll(() => {
  bus.disconnect();
});

test('regression: getter is not called after configureMembers (#60)', () => {
  class TestInterface extends Interface {
    _myPrivateProperty: string;

    constructor(name: string) {
      super(name);
      this._myPrivateProperty = 'HELLO';
    }

    get myProperty(): string {
      return this._myPrivateProperty.toLowerCase();
    }
  }

  TestInterface.configureMembers({
    properties: {
      myProperty: { signature: 's' },
    },
  });
});

test('configured interface', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const iface = object.getInterface(TEST_IFACE);
  expect(iface).toBeDefined();
  const properties = object.getInterface('org.freedesktop.DBus.Properties');

  const prop = (await call(properties, 'Get', TEST_IFACE, 'SomeProperty')) as Variant;
  expect(prop).toBeInstanceOf(Variant);
  expect(prop.signature).toEqual('s');
  expect(prop.value).toEqual('foo');
  expect(prop.value).toEqual(testIface.SomeProperty);

  await call(properties, 'Set', TEST_IFACE, 'SomeProperty', new Variant('s', 'bar'));
  expect(testIface.SomeProperty).toEqual('bar');

  const result = (await call(iface, 'Echo', new Variant('s', 'foo'))) as Variant;
  expect(result).toBeInstanceOf(Variant);
  expect(result.signature).toEqual('s');
  expect(result.value).toEqual('foo');

  const onHelloWorld = vi.fn();
  iface.once('HelloWorld', onHelloWorld);

  await call(iface, 'EmitSignals');
  expect(onHelloWorld).toHaveBeenCalledWith('hello', 'world');
});

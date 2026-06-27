// Test that signals emit correctly

import { afterAll, beforeAll, expect, test, vi } from 'vitest';

import { sessionBus, Variant } from '@/index';
import { Interface, method, signal } from '@/service/interface';

import { call, waitForMessage } from '../util';

const TEST_NAME = 'org.test.signals';
const TEST_NAME2 = 'org.test.signals_name2';
const TEST_PATH = '/org/test/path';
const TEST_IFACE = 'org.test.iface';
const TEST_XML = `
<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="org.freedesktop.DBus.Introspectable">
    <method name="Introspect">
      <arg name="data" direction="out" type="s"/>
    </method>
  </interface>
  <interface name="org.freedesktop.DBus.Peer">
    <method name="GetMachineId">
      <arg direction="out" name="machine_uuid" type="s"/>
    </method>
    <method name="Ping"/>
  </interface>
  <interface name="org.freedesktop.DBus.Properties">
    <method name="Get">
      <arg direction="in" type="s"/>
      <arg direction="in" type="s"/>
      <arg direction="out" type="v"/>
    </method>
    <method name="Set">
      <arg direction="in" type="s"/>
      <arg direction="in" type="s"/>
      <arg direction="in" type="v"/>
    </method>
    <method name="GetAll">
      <arg direction="in" type="s"/>
      <arg direction="out" type="a{sv}"/>
    </method>
    <signal name="PropertiesChanged">
      <arg type="s"/>
      <arg type="a{sv}"/>
      <arg type="as"/>
    </signal>
  </interface>
  <interface name="org.test.iface">
    <method name="EmitSignals"/>
    <signal name="HelloWorld">
      <arg type="s"/>
    </signal>
    <signal name="SignalMultiple">
      <arg type="s"/>
      <arg type="s"/>
    </signal>
    <signal name="SignalComplicated">
      <arg type="v"/>
    </signal>
  </interface>
</node>
`;

const bus = sessionBus();
bus.on('error', (err: Error) => {
  console.log(`got unexpected connection error:\n${err.stack ?? ''}`);
});
const bus2 = sessionBus();
bus2.on('error', (err: Error) => {
  console.log(`got unexpected connection error:\n${err.stack ?? ''}`);
});

class SignalsInterface extends Interface {
  @signal({ signature: 's' })
  HelloWorld(value: string): string {
    return value;
  }

  @signal({ signature: 'ss' })
  SignalMultiple(): string[] {
    return ['hello', 'world'];
  }

  // a really complicated variant
  complicated = new Variant('a{sv}', {
    foo: new Variant('s', 'bar'),
    bar: new Variant('d', 53),
    bat: new Variant('v', new Variant('as', ['foo', 'bar', 'bat'])),
    baz: new Variant('(doodoo)', [1, '/', '/', 1, '/', '/']),
    fiz: new Variant('(as(s(v)))', [
      ['one', 'two'],
      ['three', [new Variant('as', ['four', 'five'])]],
    ]),
    buz: new Variant('av', [
      new Variant('as', ['foo']),
      new Variant('a{ss}', { foo: 'bar' }),
      new Variant('v', new Variant('(asas)', [['bar'], ['foo']])),
      new Variant('v', new Variant('v', new Variant('as', ['one', 'two']))),
      new Variant('a{ss}', { foo: 'bar' }),
    ]),
  });

  @signal({ signature: 'v' })
  SignalComplicated(): Variant {
    return this.complicated;
  }

  @method({ inSignature: '', outSignature: '' })
  EmitSignals(): void {
    this.HelloWorld('hello');
    this.SignalMultiple();
    this.SignalComplicated();
  }
}

const testIface = new SignalsInterface(TEST_IFACE);
const testIface2 = new SignalsInterface(TEST_IFACE);

const createTestService = async (name: string) => {
  const testBus = sessionBus();
  const iface = new SignalsInterface(TEST_IFACE);

  await testBus.requestName(name);
  testBus.export(TEST_PATH, iface);

  return testBus;
};

beforeAll(async () => {
  await Promise.all([bus.requestName(TEST_NAME), bus2.requestName(TEST_NAME2)]);
  bus.export(TEST_PATH, testIface);
  bus2.export(TEST_PATH, testIface2);
});

afterAll(() => {
  bus.disconnect();
  bus2.disconnect();
});

test('test that signals work correctly', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const iface = object.getInterface(TEST_IFACE);

  const onHelloWorld = vi.fn();
  const onSignalMultiple = vi.fn();
  const onSignalMultiple2 = vi.fn();
  const onSignalComplicated = vi.fn();

  iface.once('HelloWorld', onHelloWorld);
  iface.on('SignalMultiple', onSignalMultiple);
  iface.on('SignalMultiple', onSignalMultiple2);
  iface.on('SignalComplicated', onSignalComplicated);

  await call(iface, 'EmitSignals');

  expect(onHelloWorld).toHaveBeenCalledWith('hello');
  expect(onSignalMultiple).toHaveBeenCalledWith('hello', 'world');
  expect(onSignalMultiple2).toHaveBeenCalledWith('hello', 'world');
  expect(onSignalComplicated).toHaveBeenCalledWith(testIface.complicated);

  // removing the event listener on the interface should remove the event
  // listener on the bus as well
  expect(bus._signals.eventNames().length).toEqual(2);
  iface.removeListener('SignalMultiple', onSignalMultiple);
  expect(bus._signals.eventNames().length).toEqual(2);

  // removing the listener on a signal should not remove them all
  onSignalMultiple2.mockClear();
  await call(iface, 'EmitSignals');
  expect(onSignalMultiple2).toHaveBeenCalledWith('hello', 'world');

  iface.removeListener('SignalMultiple', onSignalMultiple2);
  expect(bus._signals.eventNames().length).toEqual(1);
  iface.removeListener('SignalComplicated', onSignalComplicated);
  expect(bus._signals.eventNames().length).toEqual(0);
});

test('signals dont get mixed up between names that define objects on the same path and interface', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const object2 = await bus.getProxyObject(TEST_NAME2, TEST_PATH);

  const iface = object.getInterface(TEST_IFACE);
  const iface2 = object2.getInterface(TEST_IFACE);

  const cb = vi.fn();
  const cb2 = vi.fn();

  iface.on('HelloWorld', cb);
  iface.on('SignalMultiple', cb);
  iface.on('SignalComplicated', cb);

  iface2.on('HelloWorld', cb2);
  iface2.on('SignalMultiple', cb2);
  iface2.on('SignalComplicated', cb2);

  await call(iface, 'EmitSignals');

  expect(cb).toHaveBeenCalledTimes(3);
  expect(cb2).toHaveBeenCalledTimes(0);
});

test('regression #64: adding multiple listeners to a signal', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const iface = object.getInterface(TEST_IFACE);

  const cb = vi.fn();
  const cb2 = vi.fn();
  const cb3 = vi.fn();

  iface.on('HelloWorld', cb);
  iface.on('HelloWorld', cb2);
  iface.on('HelloWorld', cb3);

  await call(iface, 'EmitSignals');

  expect(cb).toHaveBeenCalledTimes(1);
  expect(cb2).toHaveBeenCalledTimes(1);
  expect(cb3).toHaveBeenCalledTimes(1);

  iface.removeListener('HelloWorld', cb);
  iface.removeListener('HelloWorld', cb2);

  await call(iface, 'EmitSignals');

  expect(cb).toHaveBeenCalledTimes(1);
  expect(cb2).toHaveBeenCalledTimes(1);
  expect(cb3).toHaveBeenCalledTimes(2);

  iface.removeListener('HelloWorld', cb3);

  await call(iface, 'EmitSignals');

  expect(cb).toHaveBeenCalledTimes(1);
  expect(cb2).toHaveBeenCalledTimes(1);
  expect(cb3).toHaveBeenCalledTimes(2);
});

test('bug #86: signals dont get lost when no previous method calls have been made', async () => {
  // clear the name owners cache from previous tests
  bus._nameOwners = {};

  // when providing XML data, no introspection call is made
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH, TEST_XML);
  const iface = object.getInterface(TEST_IFACE);
  const cb = vi.fn();

  iface.on('HelloWorld', cb);
  iface.on('SignalMultiple', cb);
  iface.on('SignalComplicated', cb);

  // don't call EmitSignals through the proxy object
  testIface.EmitSignals();

  // allow signal handlers to run
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, 0);
  });

  expect(cb).toHaveBeenCalledTimes(3);
});

test('client continues receive signals from restarted DBus service', async () => {
  const clientBus = sessionBus();

  const testServiceName = 'local.test.signals';
  let testBus = await createTestService(testServiceName);

  const object = await clientBus.getProxyObject(testServiceName, TEST_PATH);
  const iface = object.getInterface(TEST_IFACE);
  const cb = vi.fn();

  expect(clientBus._nameOwners[testServiceName]).toEqual(testBus.name);

  iface.on('HelloWorld', cb);
  iface.on('SignalMultiple', cb);
  iface.on('SignalComplicated', cb);

  await call(iface, 'EmitSignals');

  expect(cb).toHaveBeenCalledTimes(3);

  await testBus.releaseName(testServiceName);
  testBus.disconnect();

  await waitForMessage(clientBus, { member: 'NameOwnerChanged' });
  expect(clientBus._nameOwners[testServiceName]).toEqual('');

  testBus = await createTestService(testServiceName);

  await waitForMessage(clientBus, { member: 'NameOwnerChanged' });
  expect(clientBus._nameOwners[testServiceName]).toEqual(testBus.name);

  await call(iface, 'EmitSignals');

  expect(cb).toHaveBeenCalledTimes(6);

  clientBus.disconnect();
  testBus.disconnect();
});

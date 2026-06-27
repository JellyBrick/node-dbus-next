import { afterAll, beforeAll, expect, test } from 'vitest';

import { sessionBus, Variant } from '@/index';
import { Interface, method } from '@/service/interface';

import { call } from '../util';

const TEST_NAME = 'org.test.aybuffer';
const TEST_PATH = '/org/test/path';
const TEST_IFACE = 'org.test.iface';

const bus = sessionBus();
bus.on('error', (err: Error) => {
  console.log(`got unexpected connection error:\n${err.stack ?? ''}`);
});

class AyBufferInterface extends Interface {
  @method({ inSignature: 'ay', outSignature: 'ay' })
  EchoBuffer(what: Buffer): Buffer {
    expect(what).toEqual(expect.any(Buffer));
    return what;
  }

  @method({ inSignature: 'aay', outSignature: 'aay' })
  EchoAay(what: Buffer[]): Buffer[] {
    expect(what).toEqual(expect.any(Array));
    for (const buf of what) {
      expect(buf).toEqual(expect.any(Buffer));
    }
    return what;
  }

  @method({ inSignature: 'v', outSignature: 'v' })
  EchoAyVariant(what: Variant): Variant {
    expect(what.signature).toEqual('ay');
    expect(what.value).toEqual(expect.any(Buffer));
    return what;
  }
}

const testIface = new AyBufferInterface(TEST_IFACE);

beforeAll(async () => {
  await bus.requestName(TEST_NAME);
  bus.export(TEST_PATH, testIface);
});

afterAll(() => {
  bus.disconnect();
});

test('dbus type ay should be a buffer', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const iface = object.getInterface(TEST_IFACE);

  const ayArray = [1, 2, 3];
  const buf = Buffer.from(ayArray);
  let result = await call(iface, 'EchoBuffer', buf);
  expect(result).toEqual(buf);

  // it should work with arrays to for compatibility with earlier versions
  result = await call(iface, 'EchoBuffer', ayArray);
  expect(result).toEqual(buf);

  // regression #57
  const ayArray2 = [4, 5, 6];
  const buf2 = Buffer.from(ayArray2);

  const bufArray = [buf, buf2];
  result = await call(iface, 'EchoAay', bufArray);
  expect(result).toEqual(bufArray);

  // compat with earlier versions
  const aayBufArray = [ayArray, ayArray2];
  result = await call(iface, 'EchoAay', aayBufArray);
  expect(result).toEqual(bufArray);

  // make sure it works with variants
  const bufVariant = new Variant('ay', buf);
  result = await call(iface, 'EchoAyVariant', bufVariant);
  expect(result).toEqual(bufVariant);

  const arrayBufVariant = new Variant('ay', ayArray);
  result = await call(iface, 'EchoAyVariant', arrayBufVariant);
  expect(result).toEqual(new Variant('ay', buf));
});

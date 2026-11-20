// Members configured on an Interface subclass must be visible on its instances.
// These run without a bus, so `pnpm test` catches regressions that otherwise only
// show up in the integration suite.

import { describe, expect, it } from 'vitest';

import { Interface, method, property, signal } from '@/service/interface';

class ConfiguredInterface extends Interface {
  Greeting = 'hello';

  Ping(): string {
    return 'pong';
  }

  Changed(): string {
    return 'changed';
  }
}

ConfiguredInterface.configureMembers({
  properties: { Greeting: { signature: 's' } },
  methods: { Ping: { outSignature: 's' } },
  signals: { Changed: { signature: 's' } },
});

class DecoratedInterface extends Interface {
  @property({ signature: 's' })
  Greeting = 'hello';

  @method({ outSignature: 's' })
  Ping(): string {
    return 'pong';
  }

  @signal({ signature: 's' })
  Changed(): string {
    return 'changed';
  }
}

describe('Interface.configureMembers()', () => {
  // Regression: class field declarations for $properties, $methods and $signals
  // defined them as undefined on every instance, hiding the prototype members
  // set by configureMembers(), so the exported interface had no members.
  const iface = new ConfiguredInterface('org.test.iface');

  it('exposes configured properties on instances', () => {
    expect(Object.keys(iface.$properties ?? {})).toEqual(['Greeting']);
  });

  it('exposes configured methods on instances', () => {
    expect(Object.keys(iface.$methods ?? {})).toEqual(['Ping']);
  });

  it('exposes configured signals on instances', () => {
    expect(Object.keys(iface.$signals ?? {})).toEqual(['Changed']);
  });

  it('includes configured members in introspection', () => {
    const xml = iface.$introspect();
    expect(xml.property?.map((p) => p.$.name)).toEqual(['Greeting']);
    expect(xml.method?.map((m) => m.$.name)).toEqual(['Ping']);
    expect(xml.signal?.map((s) => s.$.name)).toEqual(['Changed']);
  });
});

describe('Interface member decorators', () => {
  const iface = new DecoratedInterface('org.test.iface');

  it('exposes decorated properties, methods and signals on instances', () => {
    expect({
      properties: Object.keys(iface.$properties ?? {}),
      methods: Object.keys(iface.$methods ?? {}),
      signals: Object.keys(iface.$signals ?? {}),
    }).toEqual({ properties: ['Greeting'], methods: ['Ping'], signals: ['Changed'] });
  });
});

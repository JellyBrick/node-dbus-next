import { describe, it, expect } from 'vitest';

import { createIntrospectBuilder, createIntrospectParser } from '@/introspect-xml';
import { Interface, method, signal, property, ACCESS_READ } from '@/service/interface';

class XmlTestInterface extends Interface {
  @method({ inSignature: 'sd', outSignature: 's' })
  Frobate(s: string, _d: number) {
    return s;
  }

  @signal({ signature: 'os' })
  Changed() {
    return '/x';
  }

  @property({ signature: 's', access: ACCESS_READ })
  Name = 'foo';
}

describe('introspection XML build/parse with fast-xml-parser', () => {
  it('round-trips a service interface through introspection XML', () => {
    const iface = new XmlTestInterface('org.test.Iface');
    const document = { node: { node: [], interface: [iface.$introspect()] } };

    const xml = createIntrospectBuilder().build(document);
    expect(xml).toContain('<interface name="org.test.Iface">');
    expect(xml).toContain('<arg direction="in" type="s"/>');

    const parsed = createIntrospectParser().parse(xml);
    const iface0 = parsed.node.interface[0];
    expect(iface0.$.name).toBe('org.test.Iface');

    const frobate = iface0.method[0];
    expect(frobate.$.name).toBe('Frobate');
    expect(frobate.arg).toHaveLength(3);
    expect(frobate.arg[0].$).toEqual({ direction: 'in', type: 's' });
    expect(frobate.arg[1].$).toEqual({ direction: 'in', type: 'd' });
    expect(frobate.arg[2].$).toEqual({ direction: 'out', type: 's' });

    const changed = iface0.signal[0];
    expect(changed.$.name).toBe('Changed');
    expect(changed.arg.map((a: { $: { type: string } }) => a.$.type).join('')).toBe('os');

    const name = iface0.property[0];
    expect(name.$).toEqual({ name: 'Name', type: 's', access: 'read' });
  });
});

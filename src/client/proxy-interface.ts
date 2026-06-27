import { EventEmitter } from 'node:events';

import { isRecord } from '@/guards';
import { isInterfaceNameValid, isMemberNameValid } from '@/validators';

import type { ProxyObject } from './proxy-object';
import type { Message } from '@/message-type';

export interface ProxySignalInfo {
  name: string;
  signature: string;
}

export interface ProxyMethodInfo {
  name: string;
  inSignature: string;
  outSignature: string;
}

export interface ProxyPropertyInfo {
  name: string;
  type: string;
  access: string;
}

class ProxyListener {
  refcount = 0;
  readonly fn: (msg: Message) => void;

  constructor(signal: ProxySignalInfo, iface: ProxyInterface) {
    this.fn = (msg) => {
      const { body, signature, sender } = msg;
      if (iface.$object.bus._nameOwners[iface.$object.name] !== sender) {
        return;
      }
      if (signature !== signal.signature) {
        console.error(
          `warning: got signature ${signature} for signal ${msg.interface ?? ''}.${signal.name} (expected ${signal.signature})`,
        );
        return;
      }
      iface.emit(signal.name, ...(body ?? []));
    };
  }
}

/**
 * A class to represent a proxy to an interface exported on the bus to be used
 * by a client. A `ProxyInterface` is gotten by interface name from the {@link
 * ProxyObject} from the {@link MessageBus}. This class is constructed
 * dynamically based on the introspection data on the bus. The advertised
 * methods of the interface are exposed as class methods that take arguments
 * and return a Promsie that resolves to types specified by the type signature
 * of the DBus method. The `ProxyInterface` is an `EventEmitter` that emits
 * events with types that are specified by the type signature of the DBus
 * signal advertised on the bus when that signal is received.
 *
 * If an interface method call returns an error, `ProxyInterface` method call
 * will throw a {@link DBusError}.
 */
export class ProxyInterface extends EventEmitter<Record<string, unknown[]>> {
  $name: string;
  $object: ProxyObject;
  $properties: ProxyPropertyInfo[];
  $methods: ProxyMethodInfo[];
  $signals: ProxySignalInfo[];
  private readonly $listeners: Record<string, ProxyListener>;

  /**
   * Create a new `ProxyInterface`. This constructor should not be called
   * directly. Use {@link ProxyObject#getInterface} to get a proxy interface.
   */
  constructor(name: string, object: ProxyObject) {
    super();
    this.$name = name;
    this.$object = object;
    this.$properties = [];
    this.$methods = [];
    this.$signals = [];
    this.$listeners = {};

    const getEventDetails = (eventName: string): [ProxySignalInfo, string] | [null, null] => {
      const signal = this.$signals.find((s) => s.name === eventName);
      if (!signal) {
        return [null, null];
      }

      const detailedEvent = JSON.stringify({
        path: this.$object.path,
        interface: this.$name,
        member: eventName,
      });

      return [signal, detailedEvent];
    };

    this.on('removeListener', (eventName: string) => {
      const [signal, detailedEvent] = getEventDetails(eventName);

      if (!signal || detailedEvent === null) {
        return;
      }

      const proxyListener = this._getEventListener(signal);

      if (proxyListener.refcount <= 0) {
        return;
      }

      proxyListener.refcount -= 1;
      if (proxyListener.refcount > 0) {
        return;
      }

      this.$object.bus
        ._removeMatch(this._signalMatchRuleString(eventName))
        .catch((error: unknown) => {
          this.$object.bus.emit('error', error);
        });
      this.$object.bus._signals.removeListener(detailedEvent, proxyListener.fn);
    });

    this.on('newListener', (eventName: string) => {
      const [signal, detailedEvent] = getEventDetails(eventName);

      if (!signal || detailedEvent === null) {
        return;
      }

      const proxyListener = this._getEventListener(signal);

      if (proxyListener.refcount > 0) {
        proxyListener.refcount += 1;
        return;
      }

      proxyListener.refcount = 1;

      this.$object.bus._addMatch(this._signalMatchRuleString(eventName)).catch((error: unknown) => {
        this.$object.bus.emit('error', error);
      });
      this.$object.bus._signals.on(detailedEvent, proxyListener.fn);
    });
  }

  _signalMatchRuleString(eventName: string): string {
    return `type='signal',sender='${this.$object.name}',interface='${this.$name}',path='${this.$object.path}',member='${eventName}'`;
  }

  _getEventListener(signal: ProxySignalInfo): ProxyListener {
    const existing = this.$listeners[signal.name];
    if (existing) {
      return existing;
    }
    const listener = new ProxyListener(signal, this);
    this.$listeners[signal.name] = listener;
    return listener;
  }

  static _fromXml(object: ProxyObject, xml: unknown): ProxyInterface | null {
    if (!isRecord(xml) || !isRecord(xml.$) || !isInterfaceNameValid(xml.$.name)) {
      return null;
    }

    const name = xml.$.name;
    const iface = new ProxyInterface(name, object);

    if (Array.isArray(xml.property)) {
      for (const p of xml.property) {
        // TODO validation
        if (
          isRecord(p) &&
          isRecord(p.$) &&
          typeof p.$.name === 'string' &&
          typeof p.$.type === 'string'
        ) {
          iface.$properties.push({
            name: p.$.name,
            type: p.$.type,
            access: typeof p.$.access === 'string' ? p.$.access : 'readwrite',
          });
        }
      }
    }

    if (Array.isArray(xml.signal)) {
      for (const s of xml.signal) {
        if (!isRecord(s) || !isRecord(s.$) || !isMemberNameValid(s.$.name)) {
          continue;
        }
        const signal: ProxySignalInfo = {
          name: s.$.name,
          signature: '',
        };

        if (Array.isArray(s.arg)) {
          for (const a of s.arg) {
            if (isRecord(a) && isRecord(a.$) && typeof a.$.type === 'string') {
              // TODO signature validation
              signal.signature += a.$.type;
            }
          }
        }

        iface.$signals.push(signal);
      }
    }

    if (Array.isArray(xml.method)) {
      for (const m of xml.method) {
        if (!isRecord(m) || !isRecord(m.$) || !isMemberNameValid(m.$.name)) {
          continue;
        }
        const method: ProxyMethodInfo = {
          name: m.$.name,
          inSignature: '',
          outSignature: '',
        };

        if (Array.isArray(m.arg)) {
          for (const a of m.arg) {
            if (!isRecord(a) || !isRecord(a.$) || typeof a.$.type !== 'string') {
              continue;
            }
            if (a.$.direction === 'in') {
              method.inSignature += a.$.type;
            } else if (a.$.direction === 'out') {
              method.outSignature += a.$.type;
            }
          }
        }

        // TODO signature validation
        iface.$methods.push(method);

        const methodName = method.name;
        const inSignature = method.inSignature;
        const outSignature = method.outSignature;
        Reflect.set(iface, methodName, (...args: unknown[]): Promise<unknown> => {
          return object._callMethod(name, methodName, inSignature, outSignature, ...args);
        });
      }
    }

    return iface;
  }
}

export type ClientInterface = ProxyInterface;

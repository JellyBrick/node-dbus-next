import { Message } from '@/message-type';
import { assertObjectPathValid } from '@/validators';

import { Interface } from './interface';

import type { SignalOptionsResolved } from './interface';
import type { ServiceBus } from './types';
import type { IntrospectInterface } from '@/introspect-types';
import type { Variant } from '@/variant';

type PropertiesChangedHandler = (
  changedProperties: Record<string, Variant>,
  invalidatedProperties: string[],
) => void;
type SignalHandler = (options: SignalOptionsResolved, result: unknown) => void;

export class ServiceObject {
  path: string;
  bus: ServiceBus;
  interfaces: Record<string, Interface>;
  private _handlers: Record<
    string,
    { propertiesChanged: PropertiesChangedHandler; signal: SignalHandler }
  >;

  constructor(path: string, bus: ServiceBus) {
    assertObjectPathValid(path);
    this.path = path;
    this.bus = bus;
    this.interfaces = {};
    this._handlers = {};
  }

  addInterface(iface: Interface): void {
    if (!(iface instanceof Interface)) {
      throw new Error(
        `object.addInterface takes an Interface as the first argument (got ${String(iface)})`,
      );
    }
    if (this.interfaces[iface.$name]) {
      throw new Error(`an interface with name '${iface.$name}' is already exported on this object`);
    }
    this.interfaces[iface.$name] = iface;

    const propertiesChangedHandler: PropertiesChangedHandler = (
      changedProperties,
      invalidatedProperties,
    ) => {
      const body = [iface.$name, changedProperties, invalidatedProperties];
      this.bus.send(
        Message.newSignal(
          this.path,
          'org.freedesktop.DBus.Properties',
          'PropertiesChanged',
          'sa{sv}as',
          body,
        ),
      );
    };

    const signalHandler: SignalHandler = (options, result) => {
      // TODO lots of repeated code with the method handler here
      const { signature, signatureTree, name } = options;
      let body: unknown[];
      if (result === undefined) {
        body = [];
      } else if (signatureTree.length === 1) {
        body = [result];
      } else if (!Array.isArray(result)) {
        throw new Error(
          `signal ${iface.$name}.${name} expected to return multiple arguments in an array (signature: '${signature}')`,
        );
      } else {
        body = result;
      }

      if (signatureTree.length !== body.length) {
        throw new Error(
          `signal ${iface.$name}.${name} returned the wrong number of arguments (got ${body.length} expected ${signatureTree.length}) for signature '${signature}'`,
        );
      }

      this.bus.send(Message.newSignal(this.path, iface.$name, name, signature, body));
    };

    this._handlers[iface.$name] = {
      propertiesChanged: propertiesChangedHandler,
      signal: signalHandler,
    };

    iface.$emitter.on('signal', signalHandler);
    iface.$emitter.on('properties-changed', propertiesChangedHandler);
  }

  removeInterface(iface: Interface): void {
    if (!(iface instanceof Interface)) {
      throw new Error(
        `object.removeInterface takes an Interface as the first argument (got ${String(iface)})`,
      );
    }
    if (!this.interfaces[iface.$name]) {
      throw new Error(`Interface ${iface.$name} not exported on this object`);
    }
    const handlers = this._handlers[iface.$name];
    if (handlers !== undefined) {
      iface.$emitter.removeListener('signal', handlers.signal);
      iface.$emitter.removeListener('properties-changed', handlers.propertiesChanged);
    }
    delete this._handlers[iface.$name];
    delete this.interfaces[iface.$name];
  }

  introspect(): IntrospectInterface[] {
    const interfaces = ServiceObject.defaultInterfaces();

    for (const i of Object.keys(this.interfaces)) {
      const iface = this.interfaces[i];
      if (iface !== undefined) {
        interfaces.push(iface.$introspect());
      }
    }

    return interfaces;
  }

  static defaultInterfaces(): IntrospectInterface[] {
    return [
      {
        $: { name: 'org.freedesktop.DBus.Introspectable' },
        method: [
          {
            $: { name: 'Introspect' },
            arg: [
              {
                $: { name: 'data', direction: 'out', type: 's' },
              },
            ],
          },
        ],
      },
      {
        $: { name: 'org.freedesktop.DBus.Peer' },
        method: [
          {
            $: { name: 'GetMachineId' },
            arg: [{ $: { direction: 'out', name: 'machine_uuid', type: 's' } }],
          },
          {
            $: { name: 'Ping' },
          },
        ],
      },
      {
        $: { name: 'org.freedesktop.DBus.Properties' },
        method: [
          {
            $: { name: 'Get' },
            arg: [
              { $: { direction: 'in', type: 's' } },
              { $: { direction: 'in', type: 's' } },
              { $: { direction: 'out', type: 'v' } },
            ],
          },
          {
            $: { name: 'Set' },
            arg: [
              { $: { direction: 'in', type: 's' } },
              { $: { direction: 'in', type: 's' } },
              { $: { direction: 'in', type: 'v' } },
            ],
          },
          {
            $: { name: 'GetAll' },
            arg: [
              { $: { direction: 'in', type: 's' } },
              { $: { direction: 'out', type: 'a{sv}' } },
            ],
          },
        ],
        signal: [
          {
            $: { name: 'PropertiesChanged' },
            arg: [{ $: { type: 's' } }, { $: { type: 'a{sv}' } }, { $: { type: 'as' } }],
          },
        ],
      },
    ];
  }
}

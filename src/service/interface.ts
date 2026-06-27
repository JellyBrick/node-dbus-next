/**
 * A module for exporting interfaces on a name on the message bus.
 *
 * @module interface
 */
import { EventEmitter } from 'node:events';

import { parseSignature, collapseSignature } from '@/signature';
import { assertInterfaceNameValid, assertMemberNameValid } from '@/validators';
import { Variant } from '@/variant';

import type {
  IntrospectInterface,
  IntrospectArg,
  IntrospectAnnotation,
  IntrospectProperty,
  IntrospectMethod,
  IntrospectSignal,
} from '@/introspect-types';
import type { SignatureNode } from '@/signature';

/**
 * Used for [`Interface`]{@link module:interface~Interface} [property]{@link
 * module:interface.property} options to specify that clients have read access
 * to the property.
 *
 * @static
 */
export const ACCESS_READ = 'read';

/**
 * Used for [`Interface`]{@link module:interface~Interface} [property]{@link
 * module:interface.property} options to specify that clients have write access
 * to the property.
 *
 * @static
 */
export const ACCESS_WRITE = 'write';

/**
 * Used for [`Interface`]{@link module:interface~Interface} [property]{@link
 * module:interface.property} options to specify that clients have read and
 * write access to the property.
 *
 * @static
 */
export const ACCESS_READWRITE = 'readwrite';

export type PropertyAccess = 'read' | 'write' | 'readwrite';

export interface PropertyOptions {
  signature: string;
  access?: PropertyAccess;
  name?: string;
  disabled?: boolean;
}

export interface MethodOptions {
  inSignature?: string;
  outSignature?: string;
  name?: string;
  disabled?: boolean;
  noReply?: boolean;
}

export interface SignalOptions {
  signature?: string;
  name?: string;
  disabled?: boolean;
}

export interface ConfigureMembersOptions {
  properties?: Record<string, PropertyOptions>;
  methods?: Record<string, MethodOptions>;
  signals?: Record<string, SignalOptions>;
}

type InterfaceMethodFn = (...args: never[]) => unknown;

export interface PropertyOptionsResolved {
  signature: string;
  signatureTree: SignatureNode[];
  access: PropertyAccess;
  name: string;
  disabled: boolean;
}

export interface MethodOptionsResolved {
  inSignature: string;
  outSignature: string;
  inSignatureTree: SignatureNode[];
  outSignatureTree: SignatureNode[];
  name: string;
  disabled: boolean;
  noReply: boolean;
  fn: InterfaceMethodFn;
}

export interface SignalOptionsResolved {
  signature: string;
  signatureTree: SignatureNode[];
  name: string;
  disabled: boolean;
  fn: InterfaceMethodFn;
}

export const invokeMethod = (
  fn: InterfaceMethodFn,
  thisArg: Interface,
  args: unknown[],
): unknown => {
  // the stored method is callable with the message body; bridge the strict signature
  const callable = fn as (...a: unknown[]) => unknown;
  return callable.apply(thisArg, args);
};

type PropertyDecoratorContext =
  | ClassFieldDecoratorContext<Interface, unknown>
  | ClassGetterDecoratorContext<Interface, unknown>
  | ClassSetterDecoratorContext<Interface, unknown>
  | ClassAccessorDecoratorContext<Interface, unknown>;

export interface DualPropertyDecorator {
  (value: unknown, context: PropertyDecoratorContext): void;
  (target: object, propertyKey: string | symbol): void;
}

export interface DualMethodDecorator {
  (value: InterfaceMethodFn, context: ClassMethodDecoratorContext<Interface>): void;
  (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): void;
}

export interface DualSignalDecorator {
  <T extends InterfaceMethodFn>(value: T, context: ClassMethodDecoratorContext<Interface>): T;
  (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): void;
}

const isDecoratorContext = (value: unknown): value is DecoratorContext =>
  typeof value === 'object' && value !== null && 'kind' in value;

const defineLegacyMember = (
  target: object,
  bag: '$properties' | '$methods' | '$signals',
  key: string,
  resolved: PropertyOptionsResolved | MethodOptionsResolved | SignalOptionsResolved,
): void => {
  const store = target as Record<string, Record<string, typeof resolved> | undefined>;
  const bagObj: Record<string, typeof resolved> =
    Object.prototype.hasOwnProperty.call(store, bag) && store[bag] ? store[bag] : { ...store[bag] };
  store[bag] = bagObj;
  bagObj[key] = resolved;
};

const makePropertyResolved = (
  options: PropertyOptions,
  signatureTree: SignatureNode[],
  name: string,
): PropertyOptionsResolved => {
  assertMemberNameValid(name);
  return {
    signature: options.signature,
    signatureTree,
    access: options.access ?? ACCESS_READWRITE,
    name,
    disabled: !!options.disabled,
  };
};

const makeMethodResolved = (
  options: MethodOptions,
  name: string,
  fn: InterfaceMethodFn,
): MethodOptionsResolved => {
  assertMemberNameValid(name);
  return {
    name,
    disabled: !!options.disabled,
    noReply: !!options.noReply,
    inSignature: options.inSignature ?? '',
    outSignature: options.outSignature ?? '',
    inSignatureTree: parseSignature(options.inSignature ?? ''),
    outSignatureTree: parseSignature(options.outSignature ?? ''),
    fn,
  };
};

const makeSignalResolved = (
  options: SignalOptions,
  name: string,
  fn: InterfaceMethodFn,
): SignalOptionsResolved => {
  assertMemberNameValid(name);
  return {
    name,
    signature: options.signature ?? '',
    signatureTree: parseSignature(options.signature ?? ''),
    disabled: !!options.disabled,
    fn,
  };
};

const makeSignalWrapper = (resolved: SignalOptionsResolved) =>
  function (this: Interface, ...args: unknown[]): unknown {
    if (resolved.disabled) {
      throw new Error('tried to call a disabled signal');
    }
    const result = invokeMethod(resolved.fn, this, args);
    this.$emitter.emit('signal', resolved, result);
    return undefined;
  };

/**
 * A decorator function to define an [`Interface`]{@link
 * module:interface~Interface} class member as a property.  The property will
 * be gotten and set from the class when users call the standard DBus methods
 * `org.freedesktop.DBus.Properties.Get`,
 * `org.freedesktop.DBus.Properties.Set`, and
 * `org.freedesktop.DBus.Properties.GetAll`. The property getters and setters
 * may throw a {@link DBusError} with an error name and message to return the
 * error to the client.
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#type-system}
 *
 * @static
 *
 * @param {object} options - The options for this property.
 * @param {string} options.signature - The DBus type signature for this property.
 * @param {access} [options.access=ACCESS_READWRITE] - The read and write
 * access of the property for clients (effects `Get` and `Set` property methods).
 * @param {string} [options.name] - The name of this property on the bus.
 * Defaults to the name of the class member being decorated.
 * @param {bool} [options.disabled=false] - Whether or not this property
 * will be advertised on the bus.
 */
export const property = (options: PropertyOptions): DualPropertyDecorator => {
  if (!options.signature) {
    throw new Error('missing signature for property');
  }
  const signatureTree = parseSignature(options.signature);
  return (target: unknown, context: unknown): void => {
    if (isDecoratorContext(context)) {
      const ctx = context as PropertyDecoratorContext;
      const key = String(ctx.name);
      const resolved = makePropertyResolved(options, signatureTree, options.name ?? key);
      ctx.addInitializer(function (this: Interface) {
        (this.$properties ??= {})[key] = resolved;
      });
    } else {
      const key = String(context as string | symbol);
      const resolved = makePropertyResolved(options, signatureTree, options.name ?? key);
      defineLegacyMember(target as object, '$properties', key, resolved);
    }
  };
};

/**
 * A decorator function to define an [`Interface`]{@link
 * module:interface~Interface} class member as a method. The method will be
 * called when the client calls it on the bus with the given arguments with
 * types specified by the `inSignature` in the method options.  The method
 * should return a result specified by the `outSignature` which will be
 * returned to the client over the message bus. If multiple output parameters
 * are specified in the `outSignature`, they should be returned within an
 * array.
 *
 * The method may also be `async` or return a `Promise` with the result and the
 * reply will be sent once the promise returns with a response body.
 *
 * The method may throw a {@link DBusError} with an error name and
 * message to return the error to the client.
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#type-system}
 *
 * @static
 *
 * @param {object} options - The options for this method.
 * @param {string} [options.inSignature=""] - The DBus type signature for the
 * input to this method.
 * @param {string} [options.outSignature=""] - The DBus type signature for the
 * output of this method.
 * @param {string} [options.name] - The name of this method on the bus.
 * Defaults to the name of the class member being decorated.
 * @param {bool} [options.disabled=false] - Whether or not this property
 * will be advertised on the bus.
 */
export const method = (options: MethodOptions = {}): DualMethodDecorator => {
  return (target: unknown, context: unknown, descriptor?: PropertyDescriptor): void => {
    if (isDecoratorContext(context)) {
      const ctx = context as ClassMethodDecoratorContext<Interface>;
      const key = String(ctx.name);
      const resolved = makeMethodResolved(
        options,
        options.name ?? key,
        target as InterfaceMethodFn,
      );
      ctx.addInitializer(function (this: Interface) {
        (this.$methods ??= {})[key] = resolved;
      });
    } else {
      const key = String(context as string | symbol);
      const resolved = makeMethodResolved(
        options,
        options.name ?? key,
        descriptor?.value as InterfaceMethodFn,
      );
      defineLegacyMember(target as object, '$methods', key, resolved);
    }
  };
};

/**
 * A decorator function to define an [`Interface`]{@link
 * module:interface~Interface} class member as a signal. To emit the signal on
 * the bus to listeners, just call the decorated method and the signal will be
 * emitted with the returned value with types specified by the `signature` in
 * the signal options. If the signal has multiple output parameters, they
 * should be returned in an array.
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#type-system}
 *
 * @static
 *
 * @param {object} options - The options for this property.
 * @param {string} options.signature - The DBus type signature for this signal.
 * @param {string} [options.name] - The name of this signal on the bus.
 * Defaults to the name of the class member being decorated.
 * @param {bool} [options.disabled=false] - Whether or not this property
 * will be advertised on the bus.
 */
export const signal = (options: SignalOptions = {}): DualSignalDecorator => {
  const decorate = (
    target: unknown,
    context: unknown,
    descriptor?: PropertyDescriptor,
  ): unknown => {
    if (isDecoratorContext(context)) {
      const ctx = context as ClassMethodDecoratorContext<Interface>;
      const key = String(ctx.name);
      const resolved = makeSignalResolved(
        options,
        options.name ?? key,
        target as InterfaceMethodFn,
      );
      ctx.addInitializer(function (this: Interface) {
        (this.$signals ??= {})[key] = resolved;
      });
      return makeSignalWrapper(resolved);
    }
    const key = String(context as string | symbol);
    const resolved = makeSignalResolved(
      options,
      options.name ?? key,
      descriptor?.value as InterfaceMethodFn,
    );
    defineLegacyMember(target as object, '$signals', key, resolved);
    if (descriptor) {
      descriptor.value = makeSignalWrapper(resolved);
    }
    return descriptor;
  };
  return decorate as unknown as DualSignalDecorator;
};

/**
 * The `Interface` is an abstract class used for defining and exporting an
 * interface on a DBus name. You can override this class to make your own DBus
 * interfaces. Use the decorators within this module to define the
 * [properties]{@link module:interface.property}, [methods]{@link
 * module:interface.method}, and [signals]{@link module:interface.signal} that
 * the interface has. These will be advertised to users in the introspection
 * xml gotten by the `org.freedesktop.DBus.Introspect` method on the name. See
 * the documentation for the decorators for more information. The constructor
 * of the `Interface` should call `super()` with the name of the interface that
 * will be exported.
 *
 * @example
 * class MyInterface extends Interface {
 *    constructor() {
 *      super('org.test.interface_name');
 *    }
 *    // define properties, methods, and signals with decorated functions
 * }
 * let bus = dbus.sessionBus();
 * let name = await bus.requestName('org.test.bus_name');
 * let iface = new MyInterface();
 * name.export('/org/test/path', iface);
 */
interface InterfaceEmitterEvents {
  signal: [options: SignalOptionsResolved, result: unknown];
  'properties-changed': [
    changedProperties: Record<string, Variant>,
    invalidatedProperties: string[],
  ];
}

export class Interface extends EventEmitter {
  $name: string;
  $emitter: EventEmitter<InterfaceEmitterEvents>;
  $properties?: Record<string, PropertyOptionsResolved>;
  $methods?: Record<string, MethodOptionsResolved>;
  $signals?: Record<string, SignalOptionsResolved>;

  /**
   * Create an interface. This should be called with the name of the interface
   * in the class that extends it.
   */
  constructor(name: string) {
    super();
    assertInterfaceNameValid(name);
    this.$name = name;
    this.$emitter = new EventEmitter<InterfaceEmitterEvents>();
  }

  /**
   * An alternative to the decorator functions to configure
   * [`Interface`]{@link module:interface~Interface} DBus members when
   * decorators cannot be supported.
   *
   * *Calling this method twice on the same `Interface` or mixing this method
   * with the decorator interface will result in undefined behavior that may be
   * specified at a future time.*
   *
   * @static
   * @param members {Object} - Member configuration object.
   */
  static configureMembers(members: ConfigureMembersOptions): void {
    const properties = members.properties ?? {};
    const methods = members.methods ?? {};
    const signals = members.signals ?? {};

    // configureMembers operates on arbitrary member names; access methods on the
    // prototype dynamically by their configured key
    const protoFns = this.prototype as unknown as Record<string, InterfaceMethodFn>;
    const protoProps: Record<string, PropertyOptionsResolved> = {};
    const protoMethods: Record<string, MethodOptionsResolved> = {};
    const protoSignals: Record<string, SignalOptionsResolved> = {};

    for (const k of Object.keys(properties)) {
      const options = properties[k];
      if (options === undefined) {
        continue;
      }
      const name = options.name ?? k;
      const access = options.access ?? ACCESS_READWRITE;
      if (!options.signature) {
        throw new Error('missing signature for property');
      }
      assertMemberNameValid(name);
      protoProps[name] = {
        signature: options.signature,
        signatureTree: parseSignature(options.signature),
        access,
        name,
        disabled: !!options.disabled,
      };
    }

    for (const k of Object.keys(methods)) {
      const options = methods[k];
      if (options === undefined) {
        continue;
      }
      const name = options.name ?? k;
      assertMemberNameValid(name);
      const fn = protoFns[k];
      if (typeof fn !== 'function') {
        throw new Error(`configureMembers: no method '${k}' found on the class`);
      }
      protoMethods[name] = {
        name,
        disabled: !!options.disabled,
        noReply: !!options.noReply,
        inSignature: options.inSignature ?? '',
        outSignature: options.outSignature ?? '',
        inSignatureTree: parseSignature(options.inSignature ?? ''),
        outSignatureTree: parseSignature(options.outSignature ?? ''),
        fn,
      };
    }

    for (const k of Object.keys(signals)) {
      const options = signals[k];
      if (options === undefined) {
        continue;
      }
      const name = options.name ?? k;
      assertMemberNameValid(name);
      const fn = protoFns[k];
      if (typeof fn !== 'function') {
        throw new Error(`configureMembers: no method '${k}' found on the class`);
      }
      const resolved: SignalOptionsResolved = {
        name,
        signature: options.signature ?? '',
        signatureTree: parseSignature(options.signature ?? ''),
        disabled: !!options.disabled,
        fn,
      };
      protoFns[k] = function (this: Interface, ...args: unknown[]): unknown {
        if (resolved.disabled) {
          throw new Error('tried to call a disabled signal');
        }
        const result = invokeMethod(resolved.fn, this, args);
        this.$emitter.emit('signal', resolved, result);
        return undefined;
      };
      protoSignals[name] = resolved;
    }

    this.prototype.$properties = protoProps;
    this.prototype.$methods = protoMethods;
    this.prototype.$signals = protoSignals;
  }

  /**
   * Emit the `PropertiesChanged` signal on an [`Interface`s]{@link
   * module:interface~Interface} associated standard
   * `org.freedesktop.DBus.Properties` interface with a map of new values and
   * invalidated properties. Pass the properties as JavaScript values.
   *
   * @static
   * @example
   * Interface.emitPropertiesChanged({ SomeProperty: 'bar' }, ['InvalidedProperty']);
   *
   * @param {module:interface~Interface} - the `Interface` to emit the `PropertiesChanged` signal on
   * @param {Object} - A map of property names and new property values that are changed.
   * @param {string[]} - A list of invalidated properties.
   */
  static emitPropertiesChanged(
    iface: Interface,
    changedProperties: Record<string, unknown>,
    invalidatedProperties: string[] = [],
  ): void {
    if (
      !Array.isArray(invalidatedProperties) ||
      !invalidatedProperties.every((p) => typeof p === 'string')
    ) {
      throw new Error('invalidated properties must be an array of strings');
    }

    // we transform them to variants here based on property signatures so they
    // don't have to
    const properties = iface.$properties ?? {};
    const changedPropertiesVariants: Record<string, Variant> = {};
    for (const p of Object.keys(changedProperties)) {
      const propOptions = properties[p];
      if (propOptions === undefined) {
        throw new Error(`got properties changed with unknown property: ${p}`);
      }
      changedPropertiesVariants[p] = new Variant(propOptions.signature, changedProperties[p]);
    }
    iface.$emitter.emit('properties-changed', changedPropertiesVariants, invalidatedProperties);
  }

  $introspect(): IntrospectInterface {
    // TODO cache xml when the interface is declared
    const xml: IntrospectInterface = {
      $: {
        name: this.$name,
      },
    };

    const properties = this.$properties ?? {};
    const propertyXml: IntrospectProperty[] = [];
    for (const p of Object.keys(properties)) {
      const property = properties[p];
      if (property === undefined || property.disabled) {
        continue;
      }
      propertyXml.push({
        $: {
          name: property.name,
          type: property.signature,
          access: property.access,
        },
      });
    }
    if (propertyXml.length) {
      xml.property = propertyXml;
    }

    const methods = this.$methods ?? {};
    const methodXml: IntrospectMethod[] = [];
    for (const m of Object.keys(methods)) {
      const methodOptions = methods[m];
      if (methodOptions === undefined || methodOptions.disabled) {
        continue;
      }

      const args: IntrospectArg[] = [];
      for (const signatureNode of methodOptions.inSignatureTree) {
        args.push({
          $: {
            direction: 'in',
            type: collapseSignature(signatureNode),
          },
        });
      }
      for (const signatureNode of methodOptions.outSignatureTree) {
        args.push({
          $: {
            direction: 'out',
            type: collapseSignature(signatureNode),
          },
        });
      }

      const annotations: IntrospectAnnotation[] = [];
      if (methodOptions.noReply) {
        annotations.push({
          $: {
            name: 'org.freedesktop.DBus.Method.NoReply',
            value: 'true',
          },
        });
      }

      methodXml.push({
        $: { name: methodOptions.name },
        arg: args,
        annotation: annotations,
      });
    }
    if (methodXml.length) {
      xml.method = methodXml;
    }

    const signals = this.$signals ?? {};
    const signalXml: IntrospectSignal[] = [];
    for (const s of Object.keys(signals)) {
      const signalOptions = signals[s];
      if (signalOptions === undefined || signalOptions.disabled) {
        continue;
      }
      const args: IntrospectArg[] = [];
      for (const signatureNode of signalOptions.signatureTree) {
        args.push({
          $: {
            type: collapseSignature(signatureNode),
          },
        });
      }
      signalXml.push({
        $: { name: signalOptions.name },
        arg: args,
      });
    }
    if (signalXml.length) {
      xml.signal = signalXml;
    }

    return xml;
  }
}

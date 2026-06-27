export interface IntrospectArg {
  $: { name?: string; direction?: string; type: string };
}

export interface IntrospectAnnotation {
  $: { name: string; value: string };
}

export interface IntrospectProperty {
  $: { name: string; type: string; access: string };
  annotation?: IntrospectAnnotation[];
}

export interface IntrospectMethod {
  $: { name: string };
  arg?: IntrospectArg[];
  annotation?: IntrospectAnnotation[];
}

export interface IntrospectSignal {
  $: { name: string };
  arg?: IntrospectArg[];
  annotation?: IntrospectAnnotation[];
}

export interface IntrospectInterface {
  $: { name: string };
  property?: IntrospectProperty[];
  method?: IntrospectMethod[];
  signal?: IntrospectSignal[];
  annotation?: IntrospectAnnotation[];
}

export interface IntrospectNode {
  $?: { name?: string };
  interface?: IntrospectInterface[];
  node?: IntrospectNode[];
}

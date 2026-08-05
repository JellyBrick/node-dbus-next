import BuilderExport, { type XMLBuilder, type XMLBuilderConstructor } from 'fast-xml-builder';
import { XMLParser } from 'fast-xml-parser';

const Builder: XMLBuilderConstructor =
  (BuilderExport as XMLBuilderConstructor & { default?: XMLBuilderConstructor }).default ??
  BuilderExport;

const ARRAY_TAGS = ['node', 'interface', 'method', 'signal', 'property', 'arg', 'annotation'];

export const createIntrospectBuilder = (): XMLBuilder => {
  return new Builder({
    ignoreAttributes: false,
    attributesGroupName: '$',
    attributeNamePrefix: '',
    format: true,
    suppressEmptyNode: true,
  });
};

export const createIntrospectParser = (): XMLParser => {
  return new XMLParser({
    ignoreAttributes: false,
    attributesGroupName: '$',
    attributeNamePrefix: '',
    isArray: (name, jpath) => {
      if (name === 'node' && jpath === 'node') {
        return false;
      }
      return ARRAY_TAGS.includes(name);
    },
  });
};

import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

export const proxySchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    enabled: { type: 'boolean', enum: [true, false] },
    host: { type: 'string' },
    port: { type: 'string' },
    protocol: { type: 'string' },
    username: { type: 'string' },
    password: { type: 'string' },
  },
  required: ['enabled'],
};

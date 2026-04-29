import { describe, expect, it } from 'vitest';

import { buildCuratedSmokeCollection } from '../src/postman/collection-transform.js';
import type { FlowDefinition, ResolvedRequest } from '../src/types.js';

const flow: FlowDefinition = {
  name: 'Payments API happy path',
  type: 'smoke',
  steps: [
    {
      stepKey: 'create-payment-1',
      operationId: 'createPayment',
      bindings: [],
      extract: [{ variable: 'createPayment.paymentId', jsonPath: '$.paymentId' }]
    },
    {
      stepKey: 'get-payment-by-id-2',
      operationId: 'getPaymentById',
      bindings: [
        {
          fieldKey: 'paymentId',
          source: 'prior_output',
          sourceStepKey: 'create-payment-1',
          variable: 'createPayment.paymentId'
        }
      ],
      extract: []
    }
  ]
};

describe('collection transform', () => {
  it('builds a curated smoke collection with scripted requests', () => {
    const generatedCollection = {
      info: { name: '[Smoke][Temp] Payments API' },
      item: []
    };
    const resolvedRequests: ResolvedRequest[] = [
      {
        step: flow.steps[0]!,
        item: {
          name: 'createPayment',
          request: {
            method: 'POST',
            url: 'https://api.example.com/payments',
            body: {
              mode: 'raw',
              raw: '{"amount":"10"}'
            }
          }
        }
      },
      {
        step: flow.steps[1]!,
        item: {
          name: 'getPaymentById',
          request: {
            method: 'GET',
            url: 'https://api.example.com/payments/{paymentId}'
          }
        }
      }
    ];

    const result = buildCuratedSmokeCollection(generatedCollection, flow, resolvedRequests);
    const items = result.collection.item as Array<Record<string, unknown>>;

    expect(result.bindingCount).toBe(1);
    expect(result.extractCount).toBe(1);
    expect(items[0]?.name).toBe('00 - Resolve Secrets');
    expect(items[2]?.request).toBeDefined();
    expect(JSON.stringify(items[2])).toContain('{{paymentId}}');
    expect(JSON.stringify(items[1])).toContain('Extract createPayment.paymentId');
  });
});

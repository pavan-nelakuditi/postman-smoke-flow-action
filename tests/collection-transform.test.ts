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
      info: { name: '[Smoke][Temp] Payments API', _postman_id: 'info-123' },
      uid: '54270406-collection-uid-123',
      response: [{ id: 'resp-123' }],
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
    expect((result.collection.info as Record<string, unknown>).name).toBe('[Smoke] Payments API happy path');
    expect((result.collection.info as Record<string, unknown>)._postman_id).toBeUndefined();
    expect((result.collection as Record<string, unknown>).uid).toBeUndefined();
    expect((result.collection as Record<string, unknown>).response).toBeUndefined();
    expect(items[0]?.name).toBe('00 - Resolve Secrets');
    expect(items[2]?.request).toBeDefined();
    expect(JSON.stringify(items[2])).toContain('{{paymentId}}');
    expect(JSON.stringify(items[1])).toContain('Extract createPayment.paymentId');
  });

  it('preserves generated example values for source=example bindings', () => {
    const exampleFlow: FlowDefinition = {
      name: 'Remote POS happy path',
      type: 'smoke',
      steps: [
        {
          stepKey: 'create-remote-invoice-1',
          operationId: 'createRemoteInvoice',
          bindings: [
            {
              fieldKey: 'customer.customerNumber',
              source: 'example'
            }
          ],
          extract: [{ variable: 'createRemoteInvoice.invoiceNumber', jsonPath: '$.invoiceNumber' }]
        }
      ]
    };

    const generatedCollection = {
      info: { name: '[Smoke][Temp] Remote POS API' },
      item: []
    };
    const resolvedRequests: ResolvedRequest[] = [
      {
        step: exampleFlow.steps[0]!,
        item: {
          name: 'createRemoteInvoice',
          request: {
            method: 'POST',
            url: 'https://api.example.com/remote-invoices',
            body: {
              mode: 'raw',
              raw: '{"customer":{"customerNumber":90001234},"delivery":true}'
            }
          }
        }
      }
    ];

    const result = buildCuratedSmokeCollection(generatedCollection, exampleFlow, resolvedRequests);
    const items = result.collection.item as Array<Record<string, unknown>>;
    const requestBody = JSON.stringify((items[1] as Record<string, unknown>).request);
    const prerequest = JSON.stringify((items[1] as Record<string, unknown>).event);

    expect(requestBody).toContain('90001234');
    expect(requestBody).not.toContain('{{customer.customerNumber}}');
    expect(prerequest).not.toContain('customer.customerNumber');
  });
});

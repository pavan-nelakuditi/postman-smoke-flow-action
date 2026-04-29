import type { FlowDefinition, ResolvedRequest } from '../types.js';
import { ValidationError } from '../lib/errors.js';

type CollectionItem = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getItemName(item: CollectionItem): string {
  return typeof item.name === 'string' ? item.name : '';
}

function getRequestDescription(item: CollectionItem): string {
  const request = asRecord(item.request);
  if (!request) return '';
  if (typeof request.description === 'string') return request.description;
  const description = asRecord(request.description);
  return typeof description?.content === 'string' ? description.content : '';
}

function flattenRequestItems(node: CollectionItem): CollectionItem[] {
  const results: CollectionItem[] = [];

  const visit = (item: CollectionItem): void => {
    if (item.request && typeof item.request === 'object') {
      results.push(item);
    }
    const children = Array.isArray(item.item) ? item.item : [];
    children.map(asRecord).filter((entry): entry is CollectionItem => Boolean(entry)).forEach(visit);
  };

  visit(node);
  return results;
}

function matchesOperationId(item: CollectionItem, operationId: string): boolean {
  const name = getItemName(item);
  const description = getRequestDescription(item);
  return (
    name === operationId ||
    name.toLowerCase() === operationId.toLowerCase() ||
    description.includes(operationId) ||
    description.toLowerCase().includes(operationId.toLowerCase())
  );
}

export function resolveFlowRequests(flow: FlowDefinition, generatedCollection: CollectionItem): ResolvedRequest[] {
  const requestItems = flattenRequestItems(generatedCollection);

  return flow.steps.map((step) => {
    const match = requestItems.find((item) => matchesOperationId(item, step.operationId));
    if (!match) {
      throw new ValidationError(`Could not resolve operationId "${step.operationId}" in the generated temporary Smoke collection.`);
    }
    return {
      step,
      item: structuredClone(match)
    };
  });
}

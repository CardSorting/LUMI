# Graph Capability

## Purpose
Knowledge graph CRUD, traversal, centrality, subgraph extraction, and structural impact analysis.

## Methods
| Method | Input | Output |
|--------|-------|--------|
| `addKnowledge` | `GraphAddKnowledgeInput` | `GraphAddKnowledgeResult` |
| `updateKnowledge` | `GraphUpdateKnowledgeInput` | `GraphUpdateKnowledgeResult` |
| `deleteKnowledge` | `GraphKnowledgeIdInput` | `{ deleted: true; kbId: string }` |
| `mergeKnowledge` | `GraphMergeKnowledgeInput` | `GraphMergeKnowledgeResult` |
| `getKnowledge` | `GraphKnowledgeIdInput` | `GraphKnowledgeResult` |
| `traverseGraph` | `GraphTraverseInput` | `GraphTraverseResult` |
| `getStructuralImpact` | `GraphStructuralImpactInput` | `GraphStructuralImpactResult` |
| `health` | — | `Promise<CapabilityHealth>` |

## Errors
- `LifecycleStateError`
- `AgentGitError` (`INVALID_ARGUMENT`) — missing kbId or content

## Lifecycle
Requires `await ctx.start()`. `graph.spider` remains a service port for LSP ingestion.

## Example
```ts
const { kbId } = await ctx.graph.addKnowledge({
  kbId: 'node-1',
  type: 'fact',
  content: 'Agents call capabilities.',
});
```

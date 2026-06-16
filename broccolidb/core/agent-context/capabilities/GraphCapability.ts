// [LAYER: CORE]
// @classification CAPABILITY
import { randomUUID } from 'node:crypto';
import type { GraphService } from '../GraphService.js';
import type { SpiderService } from '../SpiderService.js';
import { CapabilityBase } from '../CapabilityBase.js';
import {
  requireNonEmptyString,
  type GraphAddKnowledgeInput,
  type GraphAddKnowledgeResult,
  type GraphAnnotateKnowledgeInput,
  type GraphAnnotateKnowledgeResult,
  type GraphKnowledgeBatchInput,
  type GraphKnowledgeBatchResult,
  type GraphKnowledgeIdInput,
  type GraphKnowledgeResult,
  type GraphMergeKnowledgeInput,
  type GraphMergeKnowledgeResult,
  type GraphStructuralImpactInput,
  type GraphStructuralImpactResult,
  type GraphTraverseInput,
  type GraphTraverseResult,
  type GraphUpdateKnowledgeInput,
  type GraphUpdateKnowledgeResult,
} from '../capability-types.js';

export class GraphCapability extends CapabilityBase {
  readonly name = 'graph';
  readonly dependencies = ['GraphService', 'SpiderService'] as const;

  constructor(
    private readonly graphService: GraphService,
    private readonly spiderService: SpiderService,
    assertStarted: (operation: string) => void,
    isStarted: () => boolean
  ) {
    super(assertStarted, isStarted);
  }

  async addKnowledge(input: GraphAddKnowledgeInput): Promise<GraphAddKnowledgeResult> {
    return this.execute('addKnowledge', async () => {
      const kbId = await this.graphService.addKnowledge(
        requireNonEmptyString(input.kbId, 'kbId'),
        input.type,
        requireNonEmptyString(input.content, 'content'),
        {
          tags: input.tags,
          edges: input.edges,
          embedding: input.embedding,
          confidence: input.confidence,
          expiresAt: input.expiresAt,
          metadata: input.metadata,
        }
      );
      return { kbId };
    });
  }

  async updateKnowledge(input: GraphUpdateKnowledgeInput): Promise<GraphUpdateKnowledgeResult> {
    return this.execute('updateKnowledge', async () => {
      const kbId = requireNonEmptyString(input.kbId, 'kbId');
      await this.graphService.updateKnowledge(kbId, input.patch);
      return { updated: true, kbId };
    });
  }

  async deleteKnowledge(input: GraphKnowledgeIdInput): Promise<{ deleted: true; kbId: string }> {
    return this.execute('deleteKnowledge', async () => {
      const kbId = requireNonEmptyString(input.kbId, 'kbId');
      await this.graphService.deleteKnowledge(kbId);
      return { deleted: true, kbId };
    });
  }

  async mergeKnowledge(input: GraphMergeKnowledgeInput): Promise<GraphMergeKnowledgeResult> {
    return this.execute('mergeKnowledge', async () => {
      const sourceId = requireNonEmptyString(input.sourceId, 'sourceId');
      const targetId = requireNonEmptyString(input.targetId, 'targetId');
      await this.graphService.mergeKnowledge(sourceId, targetId);
      return { merged: true, sourceId, targetId };
    });
  }

  async getKnowledge(input: GraphKnowledgeIdInput): Promise<GraphKnowledgeResult> {
    return this.execute('getKnowledge', async () => ({
      item: await this.graphService.getKnowledge(requireNonEmptyString(input.kbId, 'kbId')),
    }));
  }

  async getKnowledgeBatch(input: GraphKnowledgeBatchInput): Promise<GraphKnowledgeBatchResult> {
    return this.execute('getKnowledgeBatch', async () => ({
      items: await this.graphService.getKnowledgeBatch(input.ids),
    }));
  }

  async traverseGraph(input: GraphTraverseInput): Promise<GraphTraverseResult> {
    return this.execute('traverseGraph', async () => ({
      nodes: await this.graphService.traverseGraph(
        requireNonEmptyString(input.startId, 'startId'),
        input.maxDepth ?? 2,
        input.filter
      ),
    }));
  }

  async getNodeCentrality(input: GraphKnowledgeIdInput) {
    return this.execute('getNodeCentrality', async () =>
      this.graphService.getNodeCentrality(requireNonEmptyString(input.kbId, 'kbId'))
    );
  }

  async extractSubgraph(input: GraphTraverseInput) {
    return this.execute('extractSubgraph', async () =>
      this.graphService.extractSubgraph(
        requireNonEmptyString(input.startId, 'startId'),
        input.maxDepth ?? 2,
        input.filter
      )
    );
  }

  async annotateKnowledge(input: GraphAnnotateKnowledgeInput): Promise<GraphAnnotateKnowledgeResult> {
    return this.execute('annotateKnowledge', async () => {
      const targetId = requireNonEmptyString(input.targetId, 'targetId');
      const target = await this.graphService.getKnowledge(targetId);
      const edges = [...(target.edges || [])];
      const annotationId = await this.graphService.addKnowledge(
        `note-${randomUUID()}`,
        'fact',
        requireNonEmptyString(input.annotation, 'annotation'),
        {
          tags: ['annotation'],
          metadata: { ...input.metadata, targetId, agentId: input.agentId },
        }
      );
      edges.push({ targetId: annotationId, type: 'references' });
      await this.graphService.updateKnowledge(targetId, { edges });
      return { annotationId, targetId };
    });
  }

  getStructuralImpact(input: GraphStructuralImpactInput): GraphStructuralImpactResult {
    return this.run('getStructuralImpact', () => {
      const filePath = requireNonEmptyString(input.filePath, 'filePath');
      const discovery = this.spiderService.getDiscovery();
      return {
        summary: discovery.getImportanceSummary(filePath),
        blastRadius: discovery.getBlastRadius(filePath),
        deficiencies: discovery.getDeficiencyReport(filePath),
      };
    });
  }

  get spider() {
    return {
      bootstrapGraph: () =>
        this.execute('spider.bootstrapGraph', () => this.spiderService.bootstrapGraph()),
      applyChanges: (files: Parameters<SpiderService['applyChanges']>[0]) =>
        this.execute('spider.applyChanges', () => this.spiderService.applyChanges(files)),
      auditStructure: (files?: Parameters<SpiderService['auditStructure']>[0]) =>
        this.execute('spider.auditStructure', () => this.spiderService.auditStructure(files)),
      auditWithLsp: (files: Parameters<SpiderService['auditWithLsp']>[0]) =>
        this.execute('spider.auditWithLsp', () => this.spiderService.auditWithLsp(files)),
      getEngine: () => this.run('spider.getEngine', () => this.spiderService.getEngine()),
      verifyGraphIntegrity: (deep?: boolean) =>
        this.execute('spider.verifyGraphIntegrity', () => this.spiderService.verifyGraphIntegrity(deep)),
      getDiscovery: () => this.run('spider.getDiscovery', () => this.spiderService.getDiscovery()),
      getStudyPack: (filePath: string) =>
        this.run('spider.getStudyPack', () =>
          this.spiderService.getStudyPack(requireNonEmptyString(filePath, 'filePath'))
        ),
    };
  }
}

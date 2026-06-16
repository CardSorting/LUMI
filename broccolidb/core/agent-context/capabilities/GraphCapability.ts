// [LAYER: CORE]
// @classification CAPABILITY
import { randomUUID } from 'node:crypto';
import type { GraphService } from '../GraphService.js';
import type { SpiderService } from '../SpiderService.js';
import type { GraphEdge, KnowledgeBaseItem, TraversalFilter } from '../types.js';
import { capabilityHealth, type CapabilityHealth } from '../capability-health.js';

export class GraphCapability {
  constructor(
    private readonly graphService: GraphService,
    private readonly spiderService: SpiderService,
    private readonly assertOperational: (operation: string) => void,
    private readonly isStarted: () => boolean
  ) {}

  health(): CapabilityHealth {
    return capabilityHealth('graph', this.isStarted(), ['GraphService', 'SpiderService']);
  }

  async addKnowledge(
    kbId: string,
    type: KnowledgeBaseItem['type'],
    content: string,
    options: {
      tags?: string[];
      edges?: GraphEdge[];
      embedding?: number[];
      confidence?: number;
      expiresAt?: number;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<string> {
    this.assertOperational('graph.addKnowledge');
    return this.graphService.addKnowledge(kbId, type, content, options);
  }

  async updateKnowledge(kbId: string, patch: Partial<KnowledgeBaseItem>): Promise<void> {
    this.assertOperational('graph.updateKnowledge');
    return this.graphService.updateKnowledge(kbId, patch);
  }

  async deleteKnowledge(kbId: string): Promise<void> {
    this.assertOperational('graph.deleteKnowledge');
    return this.graphService.deleteKnowledge(kbId);
  }

  async mergeKnowledge(sourceId: string, targetId: string): Promise<void> {
    this.assertOperational('graph.mergeKnowledge');
    return this.graphService.mergeKnowledge(sourceId, targetId);
  }

  async getKnowledge(itemId: string): Promise<KnowledgeBaseItem> {
    this.assertOperational('graph.getKnowledge');
    return this.graphService.getKnowledge(itemId);
  }

  async getKnowledgeBatch(ids: string[]): Promise<KnowledgeBaseItem[]> {
    this.assertOperational('graph.getKnowledgeBatch');
    return this.graphService.getKnowledgeBatch(ids);
  }

  async traverseGraph(startId: string, maxDepth = 2, filter?: TraversalFilter) {
    this.assertOperational('graph.traverseGraph');
    return this.graphService.traverseGraph(startId, maxDepth, filter);
  }

  async getNodeCentrality(kbId: string) {
    this.assertOperational('graph.getNodeCentrality');
    return this.graphService.getNodeCentrality(kbId);
  }

  async extractSubgraph(rootId: string, maxDepth = 2, filter?: TraversalFilter) {
    this.assertOperational('graph.extractSubgraph');
    return this.graphService.extractSubgraph(rootId, maxDepth, filter);
  }

  async annotateKnowledge(
    targetId: string,
    annotation: string,
    agentId?: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    this.assertOperational('graph.annotateKnowledge');
    const targetNode = await this.getKnowledge(targetId);
    const edges = [...(targetNode.edges || [])];
    const annotationId = await this.addKnowledge(`note-${randomUUID()}`, 'fact', annotation, {
      tags: ['annotation'],
      metadata: { ...metadata, targetId, agentId },
    });
    edges.push({ targetId: annotationId, type: 'references' });
    await this.updateKnowledge(targetId, { edges });
  }

  getStructuralImpact(filePath: string) {
    this.assertOperational('graph.getStructuralImpact');
    const discovery = this.spiderService.getDiscovery();
    return {
      summary: discovery.getImportanceSummary(filePath),
      blastRadius: discovery.getBlastRadius(filePath),
      deficiencies: discovery.getDeficiencyReport(filePath),
    };
  }

  get spider() {
    return {
      bootstrapGraph: () => {
        this.assertOperational('graph.spider.bootstrapGraph');
        return this.spiderService.bootstrapGraph();
      },
      applyChanges: (files: Parameters<SpiderService['applyChanges']>[0]) => {
        this.assertOperational('graph.spider.applyChanges');
        return this.spiderService.applyChanges(files);
      },
      auditStructure: (files?: Parameters<SpiderService['auditStructure']>[0]) => {
        this.assertOperational('graph.spider.auditStructure');
        return this.spiderService.auditStructure(files);
      },
      auditWithLsp: (files: Parameters<SpiderService['auditWithLsp']>[0]) => {
        this.assertOperational('graph.spider.auditWithLsp');
        return this.spiderService.auditWithLsp(files);
      },
      getEngine: () => {
        this.assertOperational('graph.spider.getEngine');
        return this.spiderService.getEngine();
      },
      verifyGraphIntegrity: (deep?: boolean) => {
        this.assertOperational('graph.spider.verifyGraphIntegrity');
        return this.spiderService.verifyGraphIntegrity(deep);
      },
      getDiscovery: () => {
        this.assertOperational('graph.spider.getDiscovery');
        return this.spiderService.getDiscovery();
      },
      getStudyPack: (filePath: string) => {
        this.assertOperational('graph.spider.getStudyPack');
        return this.spiderService.getStudyPack(filePath);
      },
    };
  }
}

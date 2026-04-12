import type { BufferedDbPool } from '../../infrastructure/db/BufferedDbPool.js';
import type { LRUCache } from '../lru-cache.js';
import type { Workspace } from '../workspace.js';
import type { LspService } from './LspService.js';
import type { CoordinatorService } from './CoordinatorService.js';
import type { ScratchpadService } from './ScratchpadService.js';
import type { CompactService } from './CompactService.js';
import type { MailboxService } from './MailboxService.js';

export interface MemoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: any; // JSON Schema
  isSearchOrReadCommand?: boolean;
  isDestructive?: boolean;
  maxResultSizeChars?: number;
  execute: (args: any, context: ServiceContext) => Promise<any>;
}

export interface ToolUseContext {
  agentId?: string;
  sessionId?: string;
  options: {
    tools: ToolDef[];
  };
  onProgress?: (progress: any) => void;
}

export interface AgentProfile {
  agentId: string;
  name: string;
  role: string;
  permissions: string[];
  status: 'active' | 'completed' | 'failed' | 'running';
  memoryLayer?: MemoryMessage[];
  createdAt: number;
  lastActive: number;
}

export interface GraphEdge {
  targetId: string;
  type: 'supports' | 'contradicts' | 'blocks' | 'depends_on' | 'references';
  weight?: number; // 0.0 to 1.0 relevance scalar
}

export interface KnowledgeBaseItem {
  itemId: string;
  type:
    | 'fact'
    | 'vector'
    | 'rule'
    | 'hypothesis'
    | 'conclusion'
    | 'structural_snapshot'
    | 'user'
    | 'feedback'
    | 'project'
    | 'reference';
  content: string;
  tags: string[];
  edges: GraphEdge[]; // Outbound edges
  inboundEdges: GraphEdge[]; // Reverse index: edges pointing AT this node
  embedding?: number[]; // Vector embeddings
  confidence: number; // 0.0–1.0 confidence score
  hubScore: number; // Pre-calculated centrality
  expiresAt?: number | null;
  metadata: Record<string, any>;
  createdAt: number;
}

export interface TaskItem {
  taskId: string;
  agentId: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  description: string;
  linkedKnowledgeIds?: string[];
  result?: any;
  createdAt: number;
  updatedAt: number;
}

export interface TaskContext {
  task: TaskItem;
  resolvedGraph: KnowledgeBaseItem[];
}

export interface TraversalFilter {
  edgeTypes?: GraphEdge['type'][];
  minWeight?: number;
  direction?: 'outbound' | 'inbound' | 'both';
}

export interface SubgraphResult {
  nodes: KnowledgeBaseItem[];
  edges: { sourceId: string; targetId: string; type: string; weight?: number }[];
}

export interface ContradictionReport {
  nodeId: string;
  conflictingNodeId: string;
  confidence: number;
  evidencePath: string[];
}

export interface Pedigree {
  nodeId: string;
  effectiveConfidence: number;
  lineage: {
    nodeId: string;
    type: string;
    content: string;
    timestamp: number;
    confidence: number;
  }[];
  supportingEvidenceIds: string[];
}

export interface ImpactReport {
  isValid: boolean;
  contradictions: ContradictionReport[];
  suggestions: string[];
  soundnessDelta: number;
}

export interface AiService {
  isAvailable: () => boolean;
  getGraphForSession: (sessionId: string) => Promise<any>;
  auditCodeAgainstRule: (path: string, code: string, rule: string) => Promise<any>;
  completeOneOff(prompt: string, options: { model: string; maxTokens: number; system: string }): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }>;
  evaluateLogicRelationship: (contentA: string, contentB: string) => Promise<'supports' | 'contradicts' | 'blocks' | 'depends_on' | 'references' | 'neutral'>;
  explainReasoningChain: (content: string, lineage: { content: string; type: string }[]) => Promise<string>;
}

export interface ServiceContext {
  db: BufferedDbPool;
  aiService: AiService | null;
  kbCache: LRUCache<string, KnowledgeBaseItem>;
  workspace: Workspace;
  userId: string;
  push: (op: any, agentId?: string) => Promise<void>;
  pushBatch: (ops: any[], agentId?: string) => Promise<void>;
  searchKnowledge: (
    query: string,
    tags?: string[],
    limit?: number,
    queryEmbedding?: number[],
    options?: { augmentWithGraph?: boolean; skipVerification?: boolean }
  ) => Promise<KnowledgeBaseItem[]>;
  updateTaskStatus: (taskId: string, status: any, result?: any) => Promise<void>;
  getStructuralImpact: (filePath: string) => { summary: string; blastRadius: any };
  pasteStore: import('./PasteStore.js').PasteStore;
  compact: import('./CompactService.js').CompactService;
  storage: import('../../infrastructure/storage/StorageService.js').StorageService;
  token: import('./TokenService.js').TokenService;
  lsp: LspService;
  coordinator: CoordinatorService;
  scratchpad: ScratchpadService;
  mailbox: MailboxService;
  toolUseContext?: ToolUseContext;
}

export interface IAgentContext {
  getStructuralImpact(filePath: string): { summary: string; blastRadius: any };
  searchKnowledge(
    query: string,
    tags?: string[],
    limit?: number,
    queryEmbedding?: number[],
    options?: any
  ): Promise<KnowledgeBaseItem[]>;
  flush(): Promise<void>;
  annotateKnowledge(
    targetId: string,
    annotation: string,
    agentId?: string,
    metadata?: Record<string, any>
  ): Promise<void>;
}

export type SuggestionType = 'fix' | 'design' | 'learn' | 'feature';

export interface PromptSuggestion {
  text: string;
  type: SuggestionType;
  impact?: number; // 0.0 to 1.0 architectural impact
}

export interface AgentBundle {
  profile: AgentProfile;
  activeTasks: TaskItem[];
  recentKnowledge: KnowledgeBaseItem[];
}

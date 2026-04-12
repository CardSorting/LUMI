import Database from "better-sqlite3"
import * as fs from "fs"
import { CompiledQuery, Kysely, SqliteDialect } from "kysely"
import * as path from "path"

export interface Schema {
	users: {
		id: string
		createdAt: number
	}
	workspaces: {
		id: string
		userId: string
		sharedMemoryLayer: string // JSON array string
		createdAt: number
	}
	repositories: {
		id: string
		workspaceId: string
		repoId: string
		repoPath: string
		forkedFrom?: string
		forkedFromRemote?: string
		defaultBranch: string
		createdAt: number
	}
	branches: {
		repoPath: string // Composite key part: {repoPath}/{name}
		name: string
		head: string
		isEphemeral: number // boolean as 0/1
		createdAt: number
		expiresAt: number | null
	}
	tags: {
		repoPath: string
		name: string
		head: string
		createdAt: number
	}
	nodes: {
		id: string
		repoPath: string
		parentId: string | null
		data: string // JSON string
		message: string
		timestamp: number
		author: string
		type: "snapshot" | "summary" | "diff"
		tree: string | null // JSON string (legacy flat tree)
		changes: string | null // JSON string of changed paths
		usage: string | null // JSON string
		metadata: string | null // JSON string
	}
	trees: {
		repoPath: string
		id: string // Renamed from hash for consistency
		entries: string // JSON string of Record<string, TreeEntry>
		createdAt: number
	}
	files: {
		id: string // CAS hash
		path: string
		content: string
		encoding: string
		size: number
		updatedAt: number
		author: string
	}
	reflog: {
		id: string
		repoPath: string
		ref: string
		oldHead: string | null
		newHead: string
		author: string
		message: string
		timestamp: number
		operation: string
	}
	stashes: {
		id: string
		repoPath: string
		branch: string
		nodeId: string
		data: string // JSON string
		tree: string // JSON string
		label: string
		createdAt: number
	}
	claims: {
		repoPath: string
		branch: string
		path: string // encoded path
		author: string
		timestamp: number
		expiresAt: number
	}
	telemetry: {
		id: string
		repoPath: string
		agentId: string
		taskId: string | null
		promptTokens: number
		completionTokens: number
		totalTokens: number
		modelId: string
		cost: number
		timestamp: number
		environment: string // JSON string
	}
	telemetry_aggregates: {
		repoPath: string
		id: string // 'global', 'agent_{id}', 'task_{id}'
		totalCommits: number
		totalTokens: number
		totalCost: number
	}
	agents: {
		id: string // agentId
		userId: string
		name: string
		role: string
		permissions: string // JSON string
		memoryLayer: string // JSON string
		createdAt: number
		lastActive: number
	}
	knowledge: {
		id: string // itemId
		userId: string
		type: string
		content: string
		tags: string // JSON string
		edges: string // JSON string
		inboundEdges: string // JSON string
		embedding: string | null // JSON string
		confidence: number
		hubScore: number
		expiresAt: number | null
		metadata: string // JSON string
		createdAt: number
	}
	tasks: {
		id: string // taskId
		userId: string
		agentId: string
		status: string
		description: string
		complexity: number
		linkedKnowledgeIds: string // JSON string
		result: string | null // JSON string
		createdAt: number
		updatedAt: number
	}
	audit_events: {
		id: string
		userId: string
		agentId: string | null
		type: string
		data: string
		createdAt: number
	}
	settings: {
		key: string
		value: string
		updatedAt: number
	}
	logical_constraints: {
		id: string
		repoPath: string
		pathPattern: string // glob pattern
		knowledgeId: string
		severity: "blocking" | "warning"
		createdAt: number
	}
	knowledge_edges: {
		sourceId: string
		targetId: string
		type: string
		weight: number
	}
	decisions: {
		id: string
		repoPath: string
		agentId: string
		taskId: string | null
		decision: string
		rationale: string
		knowledgeIds: string // JSON array of contributing knowledge
		timestamp: number
	}
	agent_streams: {
		id: string
		externalId: string | null
		parentId: string | null
		focus: string
		status: "active" | "completed" | "failed"
		sharedMemoryLayer: string | null // JSON array
		createdAt: number
	}
	agent_tasks: {
		id: string
		streamId: string
		description: string
		status: "pending" | "running" | "completed" | "failed"
		result: string | null
		complexity: number
		linkedKnowledgeIds: string | null // JSON array
		metadata: string | null
		createdAt: number
	}
	agent_memory: {
		streamId: string
		key: string
		value: string
		updatedAt: number
	}
	agent_cognitive_snapshots: {
		id: string
		streamId: string
		content: string
		embedding: string
		metadata: string | null
		createdAt: number
	}
	agent_knowledge: {
		id: string
		userId: string
		streamId: string
		type: string // 'fact' | 'vector' | 'rule'
		content: string
		tags: string // JSON array
		embedding: string | null // JSON array
		confidence: number
		hubScore: number
		expiresAt: number | null
		metadata: string | null // JSON object
		createdAt: number
	}
	agent_knowledge_edges: {
		sourceId: string
		targetId: string
		type: string // 'supports' | 'contradicts' | 'blocks' | 'depends_on' | 'references'
		weight: number
		createdAt: number
	}
	swarm_locks: {
		resource: string
		ownerId: string
		expiresAt: number
		createdAt: number
	}
}

let _db: Kysely<Schema> | null = null
let _dbPath: string | null = null

export function setDbPath(dbPath: string) {
	_dbPath = dbPath
}

export async function getDb(): Promise<Kysely<Schema>> {
	if (_db) return _db
	if (!_dbPath) {
		// Default path if not set
		_dbPath = path.resolve(process.cwd(), "codemarie.db")
	}

	const dbDir = path.dirname(_dbPath)
	if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

	_db = new Kysely<Schema>({
		dialect: new SqliteDialect({
			database: new Database(_dbPath),
		}),
	})

	const execute = (q: string) => _db?.executeQuery(CompiledQuery.raw(q))

	// Performance Tweaks (WAL Mode)
	await execute("PRAGMA journal_mode = WAL;")
	await execute("PRAGMA synchronous = NORMAL;")
	await execute("PRAGMA foreign_keys = ON;")

	// Schema Initialization
	await execute(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    createdAt BIGINT
  )`)

	await execute(`CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    sharedMemoryLayer TEXT,
    createdAt BIGINT,
    FOREIGN KEY(userId) REFERENCES users(id)
  )`)

	await execute(`CREATE TABLE IF NOT EXISTS repositories (
    id TEXT PRIMARY KEY,
    workspaceId TEXT NOT NULL,
    repoId TEXT NOT NULL,
    repoPath TEXT NOT NULL,
    forkedFrom TEXT,
    forkedFromRemote TEXT,
    defaultBranch TEXT NOT NULL,
    createdAt BIGINT,
    FOREIGN KEY(workspaceId) REFERENCES workspaces(id)
  )`)

	await execute(`CREATE TABLE IF NOT EXISTS branches (
    repoPath TEXT NOT NULL,
    name TEXT NOT NULL,
    head TEXT NOT NULL,
    isEphemeral INTEGER DEFAULT 0,
    createdAt BIGINT,
    expiresAt BIGINT,
    PRIMARY KEY(repoPath, name)
  )`)

	await execute(`CREATE TABLE IF NOT EXISTS tags (
    repoPath TEXT NOT NULL,
    name TEXT NOT NULL,
    head TEXT NOT NULL,
    createdAt BIGINT,
    PRIMARY KEY(repoPath, name)
  )`)

	await execute(`CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    repoPath TEXT NOT NULL,
    parentId TEXT,
    data TEXT,
    message TEXT,
    timestamp BIGINT,
    author TEXT,
    type TEXT,
    tree TEXT,
    changes TEXT,
    usage TEXT,
    metadata TEXT
  )`)

	await execute(`CREATE TABLE IF NOT EXISTS trees (
    repoPath TEXT NOT NULL,
    id TEXT NOT NULL,
    entries TEXT NOT NULL,
    createdAt BIGINT,
    PRIMARY KEY(repoPath, id)
  )`)

	await execute(`CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    content TEXT NOT NULL,
    encoding TEXT NOT NULL,
    size INTEGER NOT NULL,
    updatedAt BIGINT NOT NULL,
    author TEXT NOT NULL
  )`)

	await execute(`CREATE TABLE IF NOT EXISTS reflog (
    id TEXT PRIMARY KEY,
    repoPath TEXT NOT NULL,
    ref TEXT NOT NULL,
    oldHead TEXT,
    newHead TEXT NOT NULL,
    author TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp BIGINT NOT NULL,
    operation TEXT NOT NULL
  )`)

	await execute(`CREATE TABLE IF NOT EXISTS stashes (
    id TEXT PRIMARY KEY,
    repoPath TEXT NOT NULL,
    branch TEXT NOT NULL,
    nodeId TEXT NOT NULL,
    data TEXT NOT NULL,
    tree TEXT NOT NULL,
    label TEXT NOT NULL,
    createdAt BIGINT NOT NULL
  )`)

	await execute(`CREATE TABLE IF NOT EXISTS claims (
    repoPath TEXT NOT NULL,
    branch TEXT NOT NULL,
    path TEXT NOT NULL,
    author TEXT NOT NULL,
    timestamp BIGINT NOT NULL,
    expiresAt BIGINT NOT NULL,
    PRIMARY KEY(repoPath, branch, path)
  )`)

	await execute(`CREATE TABLE IF NOT EXISTS telemetry (
    id TEXT PRIMARY KEY,
    repoPath TEXT NOT NULL,
    agentId TEXT NOT NULL,
    taskId TEXT,
    promptTokens INTEGER NOT NULL,
    completionTokens INTEGER NOT NULL,
    totalTokens INTEGER NOT NULL,
    modelId TEXT NOT NULL,
    cost REAL NOT NULL,
    timestamp BIGINT NOT NULL,
    environment TEXT NOT NULL
  )`)

	await execute(`CREATE TABLE IF NOT EXISTS telemetry_aggregates (
    repoPath TEXT NOT NULL,
    id TEXT NOT NULL,
    totalCommits INTEGER DEFAULT 0,
    totalTokens INTEGER DEFAULT 0,
    totalCost REAL DEFAULT 0,
    PRIMARY KEY(repoPath, id)
  )`)

	// Indices
	await execute(`CREATE INDEX IF NOT EXISTS idx_nodes_repo ON nodes(repoPath)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_branches_repo ON branches(repoPath)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_telemetry_repo ON telemetry(repoPath)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_telemetry_task ON telemetry(taskId)`)

	await execute(`CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    permissions TEXT,
    memoryLayer TEXT,
    createdAt BIGINT,
    lastActive BIGINT,
    FOREIGN KEY(userId) REFERENCES users(id)
  )`)

	await execute(`CREATE TABLE IF NOT EXISTS knowledge (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT,
    edges TEXT,
    inboundEdges TEXT,
    embedding TEXT,
    confidence REAL,
    hubScore INTEGER,
    expiresAt BIGINT,
    metadata TEXT,
    createdAt BIGINT,
    FOREIGN KEY(userId) REFERENCES users(id)
  )`)

	// [Pass 3 Hardening] Full-Text Search (FTS5) for Knowledge Scalability
	await execute(`CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
		id UNINDEXED,
		content,
		tokenize='porter unicode61'
	)`)

	// Triggers to keep FTS in sync
	await execute(`CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
		INSERT INTO knowledge_fts(id, content) VALUES (new.id, new.content);
	END`)

	await execute(`CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
		DELETE FROM knowledge_fts WHERE id = old.id;
	END`)

	await execute(`CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge WHEN new.content != old.content BEGIN
		UPDATE knowledge_fts SET content = new.content WHERE id = old.id;
	END`)

	await execute(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    agentId TEXT NOT NULL,
    status TEXT NOT NULL,
    description TEXT NOT NULL,
    complexity REAL,
    linkedKnowledgeIds TEXT,
    result TEXT,
    createdAt BIGINT,
    updatedAt BIGINT,
    FOREIGN KEY(userId) REFERENCES users(id),
    FOREIGN KEY(agentId) REFERENCES agents(id)
  )`)

	await execute(`CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    agentId TEXT,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    createdAt BIGINT NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id)
  )`)

	await execute(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updatedAt BIGINT NOT NULL
  )`)

	await execute(`CREATE TABLE IF NOT EXISTS logical_constraints (
    id TEXT PRIMARY KEY,
    repoPath TEXT NOT NULL,
    pathPattern TEXT NOT NULL,
    knowledgeId TEXT NOT NULL,
    severity TEXT NOT NULL,
    createdAt BIGINT NOT NULL,
    FOREIGN KEY(knowledgeId) REFERENCES knowledge(id)
  )`)

	await execute(`CREATE INDEX IF NOT EXISTS idx_logical_repo ON logical_constraints(repoPath)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_logical_pattern ON logical_constraints(pathPattern)`)

	await execute(`CREATE TABLE IF NOT EXISTS knowledge_edges (
    sourceId TEXT NOT NULL,
    targetId TEXT NOT NULL,
    type TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    PRIMARY KEY(sourceId, targetId, type),
    FOREIGN KEY(sourceId) REFERENCES knowledge(id),
    FOREIGN KEY(targetId) REFERENCES knowledge(id)
  )`)

	await execute(`CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    repoPath TEXT NOT NULL,
    agentId TEXT NOT NULL,
    taskId TEXT,
    decision TEXT NOT NULL,
    rationale TEXT NOT NULL,
    knowledgeIds TEXT NOT NULL,
    timestamp BIGINT NOT NULL,
    FOREIGN KEY(agentId) REFERENCES agents(id)
  )`)

	await execute(`CREATE INDEX IF NOT EXISTS idx_edges_source ON knowledge_edges(sourceId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_edges_target ON knowledge_edges(targetId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_decisions_repo ON decisions(repoPath)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_decisions_task ON decisions(taskId)`)

	await execute(`CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(userId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_knowledge_user ON knowledge(userId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(userId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agentId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_events(type)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_events(agentId)`)

	// Agent Stream and Swarm Initialization
	await execute(
		`CREATE TABLE IF NOT EXISTS agent_streams (
			id TEXT PRIMARY KEY, 
			externalId TEXT,
			parentId TEXT, 
			focus TEXT, 
			status TEXT, 
			sharedMemoryLayer TEXT,
			createdAt BIGINT,
			FOREIGN KEY(parentId) REFERENCES agent_streams(id)
		)`,
	)
	await execute(
		`CREATE TABLE IF NOT EXISTS agent_tasks (
			id TEXT PRIMARY KEY, 
			streamId TEXT NOT NULL, 
			description TEXT NOT NULL, 
			status TEXT NOT NULL DEFAULT 'pending', 
			result TEXT,
			complexity REAL DEFAULT 1.0,
			linkedKnowledgeIds TEXT,
			metadata TEXT,
			createdAt BIGINT NOT NULL,
			FOREIGN KEY(streamId) REFERENCES agent_streams(id)
		)`,
	)
	await execute(
		`CREATE TABLE IF NOT EXISTS agent_memory (
			streamId TEXT,
			key TEXT,
			value TEXT,
			updatedAt BIGINT,
			PRIMARY KEY(streamId, key),
			FOREIGN KEY(streamId) REFERENCES agent_streams(id)
		)`,
	)
	await execute(
		`CREATE TABLE IF NOT EXISTS agent_cognitive_snapshots (
			id TEXT PRIMARY KEY,
			streamId TEXT NOT NULL,
			content TEXT NOT NULL,
			embedding TEXT NOT NULL,
			metadata TEXT,
			createdAt BIGINT NOT NULL,
			FOREIGN KEY(streamId) REFERENCES agent_streams(id)
		)`,
	)
	await execute(
		`CREATE TABLE IF NOT EXISTS agent_knowledge (
			id TEXT PRIMARY KEY,
			userId TEXT NOT NULL,
			streamId TEXT NOT NULL,
			type TEXT NOT NULL,
			content TEXT NOT NULL,
			tags TEXT,
			embedding TEXT,
			confidence REAL DEFAULT 1.0,
			hubScore INTEGER DEFAULT 0,
			expiresAt BIGINT,
			metadata TEXT,
			createdAt BIGINT NOT NULL,
			FOREIGN KEY(streamId) REFERENCES agent_streams(id)
		)`,
	)
	await execute(
		`CREATE TABLE IF NOT EXISTS agent_knowledge_edges (
			sourceId TEXT NOT NULL,
			targetId TEXT NOT NULL,
			type TEXT NOT NULL,
			weight REAL DEFAULT 1.0,
			createdAt BIGINT NOT NULL,
			PRIMARY KEY(sourceId, targetId, type),
			FOREIGN KEY(sourceId) REFERENCES agent_knowledge(id),
			FOREIGN KEY(targetId) REFERENCES agent_knowledge(id)
		)`,
	)
	await execute(
		`CREATE TABLE IF NOT EXISTS swarm_locks (
			resource TEXT PRIMARY KEY,
			ownerId TEXT NOT NULL,
			expiresAt BIGINT NOT NULL,
			createdAt BIGINT NOT NULL
		)`,
	)

	// Additional Indices
	await execute(`CREATE INDEX IF NOT EXISTS idx_swarm_locks_owner ON swarm_locks(ownerId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_swarm_locks_expires ON swarm_locks(expiresAt)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_agent_tasks_stream ON agent_tasks(streamId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_agent_streams_status ON agent_streams(status)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_agent_memory_stream ON agent_memory(streamId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_streams_external ON agent_streams(externalId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_cognitive_snapshots_stream ON agent_cognitive_snapshots(streamId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_agent_knowledge_stream ON agent_knowledge(streamId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_agent_knowledge_type ON agent_knowledge(type)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_agent_edges_source ON agent_knowledge_edges(sourceId)`)
	await execute(`CREATE INDEX IF NOT EXISTS idx_agent_edges_target ON agent_knowledge_edges(targetId)`)

	// Migrations
	try {
		await execute("ALTER TABLE nodes ADD COLUMN changes TEXT")
	} catch (_e) {}

	return _db
}

export async function getRawDb(): Promise<Database.Database> {
	if (!_db) await getDb()
	return new Database(_dbPath!) as Database.Database
}

import { ModelFamily } from "@/shared/prompts"
import { CodemarieDefaultTool } from "@/shared/tools"
import { CodemarieToolSpec } from "../spec"

export const cognitive_memory_variants: CodemarieToolSpec[] = [
	{
		id: CodemarieDefaultTool.MEM_QUERY,
		name: CodemarieDefaultTool.MEM_QUERY,
		variant: ModelFamily.GENERIC,
		description:
			"Query the cognitive memory for relevant snapshots based on semantic similarity. Use this to retrieve past context, decisions, or learned patterns that are not in the current context window.",
		parameters: [
			{
				name: "text",
				required: true,
				instruction: "The query text to find relevant snapshots for.",
				usage: "I need to remember how we handled the database migration in the past.",
			},
		],
	},
	{
		id: CodemarieDefaultTool.MEM_SNAPSHOT,
		name: CodemarieDefaultTool.MEM_SNAPSHOT,
		variant: ModelFamily.GENERIC,
		description:
			"Create a manual cognitive snapshot of the current state, important decisions, or a summary of work. This will be stored for future retrieval via semantic search.",
		parameters: [
			{
				name: "content",
				required: true,
				instruction: "The detailed content of the snapshot.",
				usage: "We decided to use Kysely for database queries because it provides better type safety than raw SQL.",
			},
			{
				name: "metadata",
				required: false,
				instruction: "A JSON string with additional metadata for the snapshot.",
				usage: '{"type": "decision", "tags": ["db", "architecture"]}',
			},
		],
	},
	{
		id: CodemarieDefaultTool.MEM_LINK,
		name: CodemarieDefaultTool.MEM_LINK,
		variant: ModelFamily.GENERIC,
		description:
			"Create an explicit bidirectional relationship (edge) between two existing cognitive knowledge nodes. Use this to represent semantic connections, causal links, or grouped architectural decisions.",
		parameters: [
			{
				name: "sourceId",
				required: true,
				instruction: "The ID of the source knowledge node.",
				usage: "node_123",
			},
			{
				name: "targetId",
				required: true,
				instruction: "The ID of the target knowledge node.",
				usage: "node_456",
			},
			{
				name: "relation",
				required: true,
				instruction: "The type of relationship (e.g., 'depends_on', 'part_of', 'refines', 'related_to').",
				usage: "depends_on",
			},
			{
				name: "weight",
				required: false,
				instruction: "The strength or distance of the relationship (0.0 to 1.0). Default is 1.0.",
				usage: "0.8",
			},
		],
	},
	{
		id: CodemarieDefaultTool.MEM_MERGE,
		name: CodemarieDefaultTool.MEM_MERGE,
		variant: ModelFamily.GENERIC,
		description:
			"Proactively merge two existing cognitive knowledge nodes. This consolidates their content and tags, and re-points all existing graph edges to the target node. Original source node is deleted after successful merge.",
		parameters: [
			{
				name: "sourceId",
				required: true,
				instruction: "The ID of the knowledge node to merge FROM (it will be deleted).",
				usage: "node_789",
			},
			{
				name: "targetId",
				required: true,
				instruction: "The ID of the knowledge node to merge INTO (it will be updated).",
				usage: "node_123",
			},
		],
	},
	{
		id: CodemarieDefaultTool.MEM_REFRESH,
		name: CodemarieDefaultTool.MEM_REFRESH,
		variant: ModelFamily.GENERIC,
		description:
			"Resets the confidence and usage markers of a specific knowledge node. Use this to prevent important but older memories from decaying or being garbage-collected.",
		parameters: [
			{
				name: "id",
				required: true,
				instruction: "The ID of the knowledge node to refresh.",
				usage: "node_123",
			},
		],
	},
	{
		id: CodemarieDefaultTool.MEM_CONTEXT,
		name: CodemarieDefaultTool.MEM_CONTEXT,
		variant: ModelFamily.GENERIC,
		description:
			"Identify files that are semantically related to a target file based on co-modification patterns in the task history (Semantic Context Routing). Helps determine which files should be modified together.",
		parameters: [
			{
				name: "path",
				required: true,
				instruction: "The path of the file to analyze context for.",
				usage: "src/core/api.ts",
			},
			{
				name: "limit",
				required: false,
				instruction: "Number of related files to return. Default is 50.",
				usage: "10",
			},
		],
	},
	{
		id: CodemarieDefaultTool.MEM_BLAST,
		name: CodemarieDefaultTool.MEM_BLAST,
		variant: ModelFamily.GENERIC,
		description:
			"Perform recursive semantic impact analysis to identify the 'blast radius' of changes to a file. Walks the history to find secondary and tertiary dependencies.",
		parameters: [
			{
				name: "path",
				required: true,
				instruction: "The path of the file to calculate blast radius for.",
				usage: "src/shared/tools.ts",
			},
			{
				name: "maxDepth",
				required: false,
				instruction: "How deep to follow the dependency chain (1, 2, or 3). Default is 2.",
				usage: "2",
			},
		],
	},
	{
		id: CodemarieDefaultTool.MEM_CHOKE,
		name: CodemarieDefaultTool.MEM_CHOKE,
		variant: ModelFamily.GENERIC,
		description:
			"Detect architectural chokepoints or 'Spaghetti Files'. Identifies files with high churn and potential bottlenecks based on historical modification patterns.",
		parameters: [
			{
				name: "limit",
				required: false,
				instruction: "Number of chokepoints to return. Default is 10.",
				usage: "5",
			},
		],
	},
	{
		id: CodemarieDefaultTool.MEM_HEAL,
		name: CodemarieDefaultTool.MEM_HEAL,
		variant: ModelFamily.GENERIC,
		description:
			"Agentic Self-Healing: Search for the last previously known stable state of a file in the cognitive history. Returns historical content that can be restored using 'write_to_file'.",
		parameters: [
			{
				name: "path",
				required: true,
				instruction: "The path of the file to recover stable state for.",
				usage: "src/core/ActionExecutor.ts",
			},
		],
	},
	{
		id: CodemarieDefaultTool.MEM_FORECAST,
		name: CodemarieDefaultTool.MEM_FORECAST,
		variant: ModelFamily.GENERIC,
		description:
			"Predict potential merge conflicts and architectural divergence before performing heavy workspace operations. Uses speculative O(log N) graph diffing between task snapshot histories.",
		parameters: [
			{
				name: "sourceStreamId",
				required: true,
				instruction: "The Task ID (streamId) to merge FROM.",
				usage: "task_abc",
			},
			{
				name: "targetStreamId",
				required: true,
				instruction: "The Task ID (streamId) to merge INTO.",
				usage: "task_xyz",
			},
		],
	},
	{
		id: CodemarieDefaultTool.MEM_CENTRALITY,
		name: CodemarieDefaultTool.MEM_CENTRALITY,
		variant: ModelFamily.GENERIC,
		description:
			"Get degree centrality metrics for a knowledge node (inbound + outbound edge count). Higher = more connected hub.",
		parameters: [
			{
				name: "id",
				required: true,
				instruction: "The Knowledge Base item ID.",
				usage: "node_123",
			},
		],
	},
	{
		id: CodemarieDefaultTool.MEM_SUBGRAPH,
		name: CodemarieDefaultTool.MEM_SUBGRAPH,
		variant: ModelFamily.GENERIC,
		description:
			"Extract a self-contained serializable subgraph from a root node — perfect for injecting into an LLM context window.",
		parameters: [
			{
				name: "id",
				required: true,
				instruction: "The root Knowledge Base item ID.",
				usage: "node_123",
			},
			{
				name: "maxDepth",
				required: false,
				instruction: "Maximum traversal depth. Default is 2.",
				usage: "3",
			},
		],
	},
	{
		id: CodemarieDefaultTool.MEM_APPEND_SHARED,
		name: CodemarieDefaultTool.MEM_APPEND_SHARED,
		variant: ModelFamily.GENERIC,
		description:
			"Contribute a global rule, fact or guideline to the swarm-wide shared memory layer (The 'Shared Rulebook'). These memories are inherited by all sub-tasks.",
		parameters: [
			{
				name: "content",
				required: true,
				instruction: "The context or directive string to share with the entire swarm.",
				usage: "All UI components must use the project's design tokens.",
			},
		],
	},
	{
		id: CodemarieDefaultTool.MEM_GET_SHARED,
		name: CodemarieDefaultTool.MEM_GET_SHARED,
		variant: ModelFamily.GENERIC,
		description:
			"Fetch the holistic 'Shared Rulebook' containing all global instructions and guidelines for the current swarm/workspace.",
		parameters: [],
	},
]

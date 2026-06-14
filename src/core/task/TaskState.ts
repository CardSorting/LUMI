import { Anthropic } from "@anthropic-ai/sdk"
import { AssistantMessageContent } from "@core/assistant-message"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { DietCodeAskResponse } from "@shared/WebviewMessage"
import type { HookExecution } from "./types/HookExecution"

export class TaskState {
	public recursionDepth = 0
	public maxTokens?: number
	public maxCost?: number

	// Task-level timing
	taskStartTimeMs = Date.now()
	taskFirstTokenTimeMs?: number

	// Streaming flags
	isStreaming = false
	isWaitingForFirstChunk = false
	didCompleteReadingStream = false

	// Content processing
	currentStreamingContentIndex = 0
	assistantMessageContent: AssistantMessageContent[] = []
	userMessageContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolResultBlockParam)[] = []
	userMessageContentReady = false
	// Map of tool names to their tool_use_id for creating proper ToolResultBlockParam
	toolUseIdMap: Map<string, string> = new Map()

	// Presentation locks
	presentAssistantMessageLocked = false
	presentAssistantMessageHasPendingUpdates = false

	// Ask/Response handling
	askResponse?: DietCodeAskResponse
	askResponseText?: string
	askResponseImages?: string[]
	askResponseFiles?: string[]
	lastMessageTs?: number

	// Plan mode specific state
	didRespondToPlanAskBySwitchingMode = false

	// Mid-stream user steering (message sent while agent is working)
	steeringInterruptRequested = false
	pendingSteeringFeedback?: {
		text?: string
		images?: string[]
		files?: string[]
	}

	// Between-turn user feedback (after a response completes, before the next API request)
	idleGapFeedbackRequested = false
	idleGapFeedbackAcknowledged = false
	pendingIdleGapFeedback?: {
		text?: string
		images?: string[]
		files?: string[]
	}

	// Context and history
	conversationHistoryDeletedRange?: [number, number]

	// Tool execution flags
	didRejectTool = false
	didAlreadyUseTool = false
	didEditFile = false
	lastToolName = "" // Track last tool used for consecutive call detection

	// Error tracking
	consecutiveMistakeCount = 0
	doubleCheckCompletionPending = false
	didAutomaticallyRetryFailedApiRequest = false
	checkpointManagerErrorMessage?: string

	// Retry tracking for auto-retry feature
	autoRetryAttempts = 0

	// Task Initialization
	isInitialized = false

	// Focus Chain / Todo List Management
	apiRequestCount = 0
	apiRequestsSinceLastTodoUpdate = 0
	currentFocusChainChecklist: string | null = null
	todoListWasUpdatedByUser = false

	// Task Abort / Cancellation
	abort = false
	didFinishAbortingStream = false
	abandoned = false

	// Hook execution tracking for cancellation
	activeHookExecution?: HookExecution

	// Policy Health & Auditing
	policyHealth: PolicyHealth = PolicyHealth.STABLE
	lastViolationDetails?: {
		violations: string[]
		hint?: string
	}

	// Auto-context summarization
	currentlySummarizing = false
	lastAutoCompactTriggerIndex?: number

	// Adaptive architectural guidance
	currentTurnReadHistory = new Map<string, number>()
	currentTurnTotalReadCount = 0
	currentTurnUniqueReadCount = 0
	currentTurnExplorationCount = 0
	taskReadHistory = new Map<string, number>()
	// Cross-Agent Intelligence (Blackboard)
	public swarmBlackboard: string[] = []
	public sovereignAuditSynthesis?: string

	// Agent ergonomics: intent routing + completion audit state
	preAuditedIntent?: string
	lastCompletionAudit?: TaskAuditMetadata
	lastAdvisoryAudit?: TaskAuditMetadata
	actModeAuditCounter?: number
	completionGateBlockCount?: number
	/** Fingerprint of the last gate-blocked completion result — detects no-op retries. */
	lastBlockedCompletionResultFingerprint?: string
	/** Timestamp of last attempt_completion invocation — used for retry cooldown. */
	lastCompletionAttemptAt?: number
	/** Monotonic attempt counter — observability + idempotency context in gate status. */
	completionAttemptCount?: number
	/** Checkpoint hash at last gate block — invalidates duplicate guard when workspace changed. */
	lastGateBlockCheckpointHash?: string
	/** Last preflight/gate block reason — agent-parseable observability in status brief. */
	lastCompletionBlockReason?: string
	/** Block count when proactive gate advisory was last emitted — debounces info spam. */
	lastProactiveGuidanceBlockCount?: number
}

export enum PolicyHealth {
	STABLE = "stable",
	WARNING = "warning",
	FAILING = "failing",
}

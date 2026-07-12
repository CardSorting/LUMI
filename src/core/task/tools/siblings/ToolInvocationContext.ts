import { AsyncLocalStorage } from "node:async_hooks"
import type Anthropic from "@anthropic-ai/sdk"
import type { DietCodeAsk, DietCodeSay } from "@shared/ExtensionMessage"

export type CapturedToolResultContent = Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolResultBlockParam

export type CapturedPresentationEvent =
	| {
			type: "say"
			args: [kind: DietCodeSay, text?: string, images?: string[], files?: string[], partial?: boolean]
	  }
	| { type: "remove_partial"; messageType: "ask" | "say"; askOrSay: DietCodeAsk | DietCodeSay }

export interface ToolInvocationContextValue {
	invocationId: string
	sequence: number
	capturePresentation: boolean
	resultContent: CapturedToolResultContent[]
	presentationEvents: CapturedPresentationEvent[]
	signal?: AbortSignal
}

const invocationStorage = new AsyncLocalStorage<ToolInvocationContextValue>()

export function runWithToolInvocationContext<T>(context: ToolInvocationContextValue, run: () => Promise<T>): Promise<T> {
	return invocationStorage.run(context, run)
}

export function getToolInvocationContext(): ToolInvocationContextValue | undefined {
	return invocationStorage.getStore()
}

export function getToolInvocationSignal(): AbortSignal | undefined {
	return invocationStorage.getStore()?.signal
}

export function resolveInvocationResultTarget<T>(fallback: T[]): T[] {
	return (invocationStorage.getStore()?.resultContent as T[] | undefined) ?? fallback
}

import { ExtensionMessage } from "@/shared/ExtensionMessage"

/**
 * gRPC handler type contracts.
 *
 * NOTE: These pure type aliases live in this leaf module (no imports back into
 * grpc-handler.ts) so that grpc-request-registry.ts and other consumers can
 * reference them without forming a cycle with grpc-handler.ts (which imports the
 * registry). grpc-handler.ts re-exports these for backward compatibility.
 */

/**
 * Type definition for a streaming response handler.
 */
export type StreamingResponseHandler<TResponse = unknown> = (
	response: TResponse,
	isLast?: boolean,
	sequenceNumber?: number,
) => Promise<void>

export type PostMessageToWebview = (message: ExtensionMessage) => Thenable<boolean | undefined>

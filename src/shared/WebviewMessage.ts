export const WEBVIEW_EXECUTABLE_COMMANDS = ["dietcode.joyZoningAudit"] as const

export type WebviewExecutableCommand = (typeof WEBVIEW_EXECUTABLE_COMMANDS)[number]

export type WebviewMessage =
	| {
			type: "grpc_request"
			grpc_request: GrpcRequest
	  }
	| {
			type: "grpc_request_cancel"
			grpc_request_cancel: GrpcCancel
	  }
	| {
			type: "execute_command"
			execute_command: ExecuteCommandRequest
	  }

export type ExecuteCommandRequest = {
	command: WebviewExecutableCommand
	args?: unknown[]
	request_id?: string
}

export function isWebviewExecutableCommand(command: string): command is WebviewExecutableCommand {
	return WEBVIEW_EXECUTABLE_COMMANDS.includes(command as WebviewExecutableCommand)
}

export type GrpcRequest = {
	service: string
	method: string
	message: any // JSON serialized protobuf message
	request_id: string // For correlating requests and responses
	is_streaming: boolean // Whether this is a streaming request
}

export type GrpcCancel = {
	request_id: string // ID of the request to cancel
}

export type DietCodeAskResponse = "yesButtonClicked" | "noButtonClicked" | "messageResponse"

export type DietCodeCheckpointRestore = "task" | "workspace" | "taskAndWorkspace"

export type TaskFeedbackType = "thumbs_up" | "thumbs_down"

import { AskResponseRequest } from "@shared/proto/dietcode/task"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"

export const OptionsButtons = ({
	options,
	selected,
	isActive,
	inputValue,
	selectedActions,
}: {
	options?: string[]
	selected?: string
	isActive?: boolean
	inputValue?: string
	selectedActions?: string[]
}) => {
	if (!options?.length) {
		return null
	}

	const hasSelected = selected !== undefined && options.includes(selected)

	return (
		<div className="flex flex-col gap-1.5 mt-2">
			<p className="text-[10px] font-medium text-muted-foreground m-0">Pick one</p>
			{options.map((option, index) => (
				<button
					className={cn(
						"w-full text-left px-2.5 py-2 text-xs rounded-md border",
						"border-editor-group-border",
						option === selected
							? "bg-[var(--vscode-focusBorder)] text-white border-transparent"
							: "bg-code text-foreground",
						hasSelected || !isActive
							? "cursor-default opacity-70"
							: "cursor-pointer hover:bg-[var(--vscode-focusBorder)] hover:text-white hover:border-transparent",
					)}
					id={`options-button-${index}`}
					key={index}
					onClick={async () => {
						if (hasSelected || !isActive) {
							return
						}
						try {
							const selectedActionsText =
								selectedActions && selectedActions.length > 0
									? `\n\n[SELECTED_ACTIONS]: ${JSON.stringify(selectedActions)}`
									: ""
							await TaskServiceClient.askResponse(
								AskResponseRequest.create({
									responseType: "messageResponse",
									text: option + (inputValue ? `: ${inputValue?.trim()}` : "") + selectedActionsText,
									images: [],
								}),
							)
						} catch (error) {
							console.error("Error sending option response:", error)
						}
					}}
					type="button">
					<span className="ph-no-capture">{option}</span>
				</button>
			))}
		</div>
	)
}

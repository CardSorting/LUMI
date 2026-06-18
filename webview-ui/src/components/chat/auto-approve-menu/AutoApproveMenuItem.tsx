import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import type React from "react"
import { VscIcon } from "@/components/ui/vsc-icon"
import { cn } from "@/lib/utils"
import { ActionMetadata } from "./types"

interface AutoApproveMenuItemProps {
	action: ActionMetadata
	isChecked: (action: ActionMetadata) => boolean
	onToggle: (action: ActionMetadata, checked: boolean) => Promise<void>
	showIcon?: boolean
	disabled?: boolean
}

const AutoApproveMenuItem = ({ action, isChecked, onToggle, showIcon = true, disabled = false }: AutoApproveMenuItemProps) => {
	const checked = isChecked(action)

	const onChange = async (e: React.MouseEvent) => {
		if (disabled) return
		e.stopPropagation()
		await onToggle(action, !checked)
	}

	return (
		<div className={cn("w-full", disabled && "opacity-50")}>
			<div className={cn("py-0.5 px-0.5 w-full", disabled ? "cursor-not-allowed" : "cursor-pointer")} onClick={onChange}>
				<VSCodeCheckbox checked={checked} disabled={disabled}>
					<div className="w-full flex text-sm items-center justify-start text-foreground gap-2">
						{showIcon && <VscIcon className="icon" name={action.icon} />}
						<span className="label">{action.label}</span>
					</div>
				</VSCodeCheckbox>
			</div>
			{action.subAction && checked ? (
				<div className="pl-6">
					<AutoApproveMenuItem action={action.subAction} isChecked={isChecked} onToggle={onToggle} showIcon={false} />
				</div>
			) : null}
		</div>
	)
}

export default AutoApproveMenuItem

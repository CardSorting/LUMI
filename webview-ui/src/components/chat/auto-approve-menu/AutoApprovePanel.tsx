import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAutoApproveActions } from "@/hooks/useAutoApproveActions"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import AutoApproveMenuItem from "./AutoApproveMenuItem"
import { updateAutoApproveSettings } from "./AutoApproveSettingsAPI"
import { ActionMetadata } from "./types"

interface AutoApprovePanelProps {
	ACTION_METADATA: ActionMetadata[]
}

/** Inline panel inside <details> — single column for narrow sidebars. */
const AutoApprovePanel: React.FC<AutoApprovePanelProps> = ({ ACTION_METADATA }) => {
	const { autoApprovalSettings } = useExtensionState()
	const { isChecked, updateAction } = useAutoApproveActions()

	return (
		<div className="overflow-y-auto pb-2 px-2 overscroll-contain max-h-[40vh]">
			<p className="mb-2 text-muted-foreground text-[11px] m-0 leading-snug">
				Choose what LUMI can do without asking you first.{" "}
				<a
					className="text-link hover:text-link-hover"
					href="https://docs.dietcode.bot/features/auto-approve#auto-approve"
					rel="noopener"
					target="_blank">
					Learn more
				</a>
			</p>

			<div className="flex flex-col gap-0.5 mb-2 w-full">
				{ACTION_METADATA.map((action) => (
					<AutoApproveMenuItem action={action} isChecked={isChecked} key={action.id} onToggle={updateAction} />
				))}
			</div>

			<div
				style={{
					height: "0.5px",
					background: getAsVar(VSC_DESCRIPTION_FOREGROUND),
					opacity: 0.1,
					margin: "8px 0",
				}}
			/>

			<div className="flex items-center gap-2">
				<VSCodeCheckbox
					checked={autoApprovalSettings.enableNotifications}
					onChange={async (e: unknown) => {
						const target = e as { target: { checked: boolean } }
						const checked = target.target.checked === true
						await updateAutoApproveSettings({
							...autoApprovalSettings,
							version: (autoApprovalSettings.version ?? 1) + 1,
							enableNotifications: checked,
						})
					}}>
					<span className="text-xs">Notify me when something runs automatically</span>
				</VSCodeCheckbox>
			</div>
		</div>
	)
}

export default AutoApprovePanel

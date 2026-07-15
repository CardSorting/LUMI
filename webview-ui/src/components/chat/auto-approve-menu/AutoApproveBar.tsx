import { ChevronRightIcon } from "lucide-react"
import { useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import AutoApprovePanel from "./AutoApprovePanel"
import { ACTION_METADATA } from "./constants"

interface AutoApproveBarProps {
	style?: React.CSSProperties
}

const AutoApproveBar = ({ style }: AutoApproveBarProps) => {
	const { autoApprovalSettings, navigateToSettings } = useExtensionState()

	const handleNavigateToFeatures = (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		navigateToSettings("features")
	}

	const enabledActionsNames = useMemo(
		() =>
			Object.keys(autoApprovalSettings.actions).filter(
				(key) => autoApprovalSettings.actions[key as keyof typeof autoApprovalSettings.actions],
			),
		[autoApprovalSettings.actions],
	)

	const enabledActionsSummary = useMemo(() => {
		const enabledActions = enabledActionsNames.map((action) => {
			return ACTION_METADATA.flatMap((a) => [a, a.subAction]).find((a) => a?.id === action)
		})

		const actionsToShow = enabledActions.filter((action) => {
			if (!action?.shortName) {
				return false
			}
			if (action.subAction?.id && enabledActionsNames.includes(action.subAction.id)) {
				return false
			}
			return true
		})

		if (actionsToShow.length === 0) {
			return "Nothing selected"
		}

		return actionsToShow.map((action) => action?.shortName).join(", ")
	}, [enabledActionsNames])

	if (enabledActionsNames.length === 0) {
		return null
	}

	return (
		<details className="lumi-inline-disclosure mx-2 border-t border-border/20 group" style={style}>
			<summary className="lumi-details-trigger flex items-center gap-1 py-2 px-2 cursor-pointer list-none text-xs min-w-0">
				<span className="whitespace-nowrap text-muted-foreground shrink-0">Run without asking:</span>
				<span className="truncate flex-1 text-muted-foreground group-open:text-foreground">{enabledActionsSummary}</span>
				<ChevronRightIcon
					aria-hidden
					className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
				/>
			</summary>
			<AutoApprovePanel ACTION_METADATA={ACTION_METADATA} />
		</details>
	)
}

export default AutoApproveBar

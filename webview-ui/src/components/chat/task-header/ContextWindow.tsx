import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { memo, useCallback, useMemo, useState } from "react"
import { Progress } from "@/components/ui/progress"
import { formatLargeNumber as formatTokenNumber } from "@/utils/format"
import CompactTaskButton from "./buttons/CompactTaskButton"
import { ContextWindowSummary } from "./ContextWindowSummary"

interface ContextWindowProgressProps {
	useAutoCondense: boolean
	lastApiReqTotalTokens?: number
	contextWindow?: number
	onSendMessage?: (command: string, files: string[], images: string[]) => void
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
}

const ContextWindow: React.FC<ContextWindowProgressProps> = ({
	contextWindow = 0,
	lastApiReqTotalTokens = 0,
	onSendMessage,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
}) => {
	const [confirmationNeeded, setConfirmationNeeded] = useState(false)

	const handleCompactClick = useCallback((e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setConfirmationNeeded((prev) => !prev)
	}, [])

	const handleConfirm = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault()
			e.stopPropagation()
			onSendMessage?.("/compact", [], [])
			setConfirmationNeeded(false)
		},
		[onSendMessage],
	)

	const handleCancel = useCallback((e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setConfirmationNeeded(false)
	}, [])

	const tokenData = useMemo(() => {
		if (!contextWindow) {
			return null
		}
		return {
			percentage: (lastApiReqTotalTokens / contextWindow) * 100,
			max: contextWindow,
			used: lastApiReqTotalTokens,
		}
	}, [contextWindow, lastApiReqTotalTokens])

	if (!tokenData) {
		return null
	}

	const usageLabel =
		tokenData.percentage >= 85
			? "Memory almost full"
			: tokenData.percentage >= 60
				? "Memory getting full"
				: "Conversation memory"

	return (
		<div className="my-1.5">
			<div className="flex items-start gap-1">
				<details className="lumi-inline-disclosure flex-1 min-w-0 group">
					<summary className="lumi-details-trigger list-none cursor-pointer">
						<div className="flex-1 min-w-0">
							<div className="flex items-center justify-between gap-2 mb-1">
								<span className="text-[10px] text-muted-foreground truncate">{usageLabel}</span>
								<span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
									{Math.round(tokenData.percentage)}%
								</span>
							</div>
							<Progress aria-label="Conversation memory used" color="success" value={tokenData.percentage} />
						</div>
					</summary>

					<div className="mt-2 px-0.5">
						<ContextWindowSummary
							cacheReads={cacheReads}
							cacheWrites={cacheWrites}
							contextWindow={tokenData.max}
							percentage={tokenData.percentage}
							tokensIn={tokensIn}
							tokensOut={tokensOut}
							tokenUsed={tokenData.used}
						/>
						<p className="text-[10px] text-muted-foreground m-0 mt-1.5 tabular-nums">
							{formatTokenNumber(tokenData.used)} of {formatTokenNumber(tokenData.max)} tokens used
						</p>
					</div>
				</details>

				<CompactTaskButton onClick={handleCompactClick} />
			</div>

			{confirmationNeeded ? (
				<div className="mt-2 px-1 flex flex-col gap-2">
					<p className="text-[11px] text-muted-foreground m-0">Free up conversation space?</p>
					<div className="flex flex-col gap-1.5">
						<VSCodeButton
							appearance="primary"
							autoFocus
							className="text-sm w-full"
							onClick={handleConfirm}
							type="button">
							Yes, shorten chat
						</VSCodeButton>
						<VSCodeButton appearance="secondary" className="text-sm w-full" onClick={handleCancel} type="button">
							Keep as is
						</VSCodeButton>
					</div>
				</div>
			) : null}
		</div>
	)
}

export default memo(ContextWindow)

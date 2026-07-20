import React, { memo, useCallback, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { formatLargeNumber as formatTokenNumber } from "@/utils/format"

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

	const usageLabel = tokenData.percentage >= 85
	return (
		<div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground my-0.5 py-0.5 border-t border-border/10">
			<div className="flex items-center gap-1.5 min-w-0">
				<span className="font-medium shrink-0">Memory:</span>
				<span className="truncate font-semibold text-foreground/90 tabular-nums">
					{formatTokenNumber(tokenData.used)} / {formatTokenNumber(tokenData.max)}
				</span>
				<span
					className={cn(
						"px-1 rounded-sm text-[9px] font-bold shrink-0",
						tokenData.percentage >= 85 ? "bg-error/15 text-error" : "bg-foreground/10 text-foreground/80",
					)}>
					{Math.round(tokenData.percentage)}%
				</span>
			</div>
			<button
				className="text-[10px] text-lumi hover:text-lumi-lavender transition-colors font-semibold shrink-0 cursor-pointer bg-transparent border-0 p-0"
				onClick={handleCompactClick}
				title="Free up conversation space"
				type="button">
				Compact
			</button>

			{confirmationNeeded && (
				<div className="absolute inset-0 bg-background/95 flex items-center justify-between px-3 gap-2 z-10 rounded-lg border border-border/40">
					<span className="text-[10px] text-foreground font-medium">Free up conversation space?</span>
					<div className="flex items-center gap-2">
						<button
							className="rounded bg-lumi px-2 py-0.5 text-[9px] font-bold text-black hover:bg-lumi-lavender"
							onClick={handleConfirm}
							type="button">
							Confirm
						</button>
						<button
							className="rounded bg-foreground/10 px-2 py-0.5 text-[9px] font-medium text-foreground/80 hover:bg-foreground/15"
							onClick={handleCancel}
							type="button">
							Cancel
						</button>
					</div>
				</div>
			)}
		</div>
	)
}

export default memo(ContextWindow)

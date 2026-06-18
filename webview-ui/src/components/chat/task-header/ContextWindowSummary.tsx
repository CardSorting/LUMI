import { ChevronRight } from "lucide-react"
import type React from "react"
import { memo } from "react"
import { formatLargeNumber as formatTokenNumber } from "@/utils/format"

interface TokenUsageInfoProps {
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
}

interface TaskContextWindowButtonsProps extends TokenUsageInfoProps {
	percentage: number
	tokenUsed: number
	contextWindow: number
	autoCompactThreshold?: number
	isThresholdChanged?: boolean
	isThresholdFadingOut?: boolean
}

const DetailsSection = memo<{
	title: string
	value: React.ReactNode
	children?: React.ReactNode
}>(({ title, value, children }) => (
	<details className="lumi-inline-disclosure group">
		<summary className="lumi-details-trigger flex items-center justify-between gap-2 py-1 cursor-pointer list-none text-xs">
			<span className="flex items-center gap-1 font-medium min-w-0">
				<ChevronRight
					aria-hidden
					className="size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
				/>
				{title}
			</span>
			<span className="text-muted-foreground shrink-0 tabular-nums">{value}</span>
		</summary>
		{children ? <div className="pl-4 pb-1 pt-0.5 text-xs text-muted-foreground">{children}</div> : null}
	</details>
))
DetailsSection.displayName = "DetailsSection"

const TOKEN_DETAILS_CONFIG = [{ title: "Input" }, { title: "Output" }, { title: "Cached writes" }, { title: "Cached reads" }]

const TokenUsageDetails = memo<TokenUsageInfoProps>(({ tokensIn, tokensOut, cacheWrites, cacheReads }) => {
	if (!tokensIn) {
		return <p className="m-0">No usage data yet.</p>
	}

	const values = [tokensIn, tokensOut, cacheWrites || 0, cacheReads || 0]
	const items = TOKEN_DETAILS_CONFIG.map((config, index) => ({ ...config, value: values[index] })).filter((item) => item.value)

	return (
		<div className="space-y-1">
			{items.map((item) => (
				<div className="flex justify-between gap-2" key={item.title}>
					<span>{item.title}</span>
					<span className="font-mono">{formatTokenNumber(item.value || 0)}</span>
				</div>
			))}
		</div>
	)
})
TokenUsageDetails.displayName = "TokenUsageDetails"

export const ContextWindowSummary: React.FC<TaskContextWindowButtonsProps> = ({
	contextWindow,
	tokenUsed,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	percentage,
	autoCompactThreshold = 0,
}) => {
	const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)

	return (
		<div className="flex flex-col gap-1 w-full">
			{autoCompactThreshold > 0 ? (
				<DetailsSection title="Auto shorten chats" value={`${(autoCompactThreshold * 100).toFixed(0)}%`}>
					<p className="m-0 leading-snug">When the chat gets long, LUMI tidies it up so things stay comfortable.</p>
				</DetailsSection>
			) : null}

			<DetailsSection
				title="Memory used"
				value={percentage ? `${percentage.toFixed(0)}%` : formatTokenNumber(contextWindow)}>
				<div className="space-y-1">
					<div className="flex justify-between gap-2">
						<span>Used</span>
						<span className="font-mono">{formatTokenNumber(tokenUsed)}</span>
					</div>
					<div className="flex justify-between gap-2">
						<span>Total</span>
						<span className="font-mono">{formatTokenNumber(contextWindow)}</span>
					</div>
					<div className="flex justify-between gap-2">
						<span>Remaining</span>
						<span className="font-mono">{formatTokenNumber(contextWindow - tokenUsed)}</span>
					</div>
				</div>
			</DetailsSection>

			{totalTokens > 0 ? (
				<DetailsSection title="Token breakdown" value={formatTokenNumber(totalTokens)}>
					<TokenUsageDetails
						cacheReads={cacheReads}
						cacheWrites={cacheWrites}
						tokensIn={tokensIn}
						tokensOut={tokensOut}
					/>
				</DetailsSection>
			) : null}
		</div>
	)
}

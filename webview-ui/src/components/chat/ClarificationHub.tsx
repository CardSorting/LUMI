import {
	AlertTriangleIcon,
	CheckCircle2Icon,
	ChevronRightIcon,
	FingerprintIcon,
	HelpCircleIcon,
	SearchIcon,
	UsersIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface ClarificationHubProps {
	interactiveClarifications?: Array<{
		label: string
		type: "provide_path" | "clarify_intent" | "select_variant" | "confirm_risk"
		data?: Record<string, unknown>
	}>
	swarmConsensus?: {
		agreementScore: number
		consensusNarrative: string
		agentFeedback: string[]
	}
}

type ClarificationType = "provide_path" | "clarify_intent" | "select_variant" | "confirm_risk"

const clarificationIcon = (type: ClarificationType) => {
	switch (type) {
		case "provide_path":
			return <FingerprintIcon aria-hidden className="size-3.5 shrink-0 text-link" />
		case "clarify_intent":
			return <SearchIcon aria-hidden className="size-3.5 shrink-0 text-amber-500" />
		case "select_variant":
			return <CheckCircle2Icon aria-hidden className="size-3.5 shrink-0 text-success" />
		case "confirm_risk":
			return <AlertTriangleIcon aria-hidden className="size-3.5 shrink-0 text-error" />
		default:
			return <HelpCircleIcon aria-hidden className="size-3.5 shrink-0" />
	}
}

export const ClarificationHub = ({ interactiveClarifications, swarmConsensus }: ClarificationHubProps) => {
	if (!interactiveClarifications?.length && !swarmConsensus) return null

	const hasClarifications = Boolean(interactiveClarifications?.length)

	return (
		<details className="lumi-inline-disclosure group mt-3 rounded-md border border-editor-group-border bg-code">
			<summary
				className={cn(
					"lumi-details-trigger list-none cursor-pointer flex items-center gap-2 px-2.5 py-2",
					"hover:bg-accent/10",
				)}>
				<HelpCircleIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="text-[11px] font-medium text-foreground flex-1 min-w-0">
					{hasClarifications ? "A few things to clear up" : "Team check-in"}
				</span>
				{swarmConsensus ? (
					<Badge className="text-[9px] font-normal shrink-0" variant="outline">
						{Math.round(swarmConsensus.agreementScore * 100)}% aligned
					</Badge>
				) : null}
				<ChevronRightIcon
					aria-hidden
					className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
				/>
			</summary>

			<div className="px-2.5 pb-2.5 pt-0 flex flex-col gap-2.5 border-t border-editor-group-border/50">
				{swarmConsensus ? (
					<div className="flex flex-col gap-1.5 pt-2">
						<div className="h-1 w-full rounded-full overflow-hidden bg-editor-group-border">
							<div
								className="h-full bg-foreground/40 transition-[width] duration-500"
								style={{ width: `${swarmConsensus.agreementScore * 100}%` }}
							/>
						</div>
						<p className="text-xs text-foreground m-0 leading-snug">{swarmConsensus.consensusNarrative}</p>
						{swarmConsensus.agentFeedback.length > 0 ? (
							<div className="flex flex-wrap gap-1">
								{swarmConsensus.agentFeedback.map((feedback, i) => (
									<span
										className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-editor-group-border text-muted-foreground"
										key={i}>
										<UsersIcon aria-hidden className="size-2.5" />
										{feedback}
									</span>
								))}
							</div>
						) : null}
					</div>
				) : null}

				{hasClarifications ? (
					<div className="flex flex-col gap-1.5">
						<p className="text-[10px] font-medium text-muted-foreground m-0">Suggested next steps</p>
						{interactiveClarifications!.map((item, i) => (
							<button
								className={cn(
									"w-full flex items-start gap-2 text-left px-2.5 py-2 rounded-md",
									"border border-editor-group-border bg-[var(--vscode-button-secondaryBackground)]",
									"text-[var(--vscode-button-secondaryForeground)] text-xs",
									"hover:bg-[var(--vscode-button-secondaryHoverBackground)]",
									"cursor-pointer",
								)}
								key={i}
								onClick={() => console.log("Action triggered:", item)}
								type="button">
								{clarificationIcon(item.type)}
								<span className="min-w-0">
									<span className="font-medium block leading-snug">{item.label}</span>
									<span className="text-[10px] opacity-70">Tap to answer</span>
								</span>
							</button>
						))}
					</div>
				) : null}
			</div>
		</details>
	)
}

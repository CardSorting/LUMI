import { ChevronRightIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { VscIcon } from "@/components/ui/vsc-icon"
import { cn } from "@/lib/utils"

interface Risk {
	impact: "high" | "medium" | "low"
	description: string
}

interface GroundingHeaderProps {
	confidenceScore: number
	ambiguityReasoning?: string
	hasActions: boolean
	risks?: Risk[]
	verifiedEntities?: string[]
	constraints?: string[]
	constraintExplanations?: Record<string, string>
}

const confidenceVariant = (score: number) => {
	if (score >= 0.8) return "success"
	if (score >= 0.5) return "warning"
	return "danger"
}

const alertStyles = {
	danger: "bg-[var(--vscode-inputValidation-errorBackground)] border-[var(--vscode-inputValidation-errorBorder)]",
	warning: "bg-[var(--vscode-inputValidation-warningBackground)] border-[var(--vscode-inputValidation-warningBorder)]",
	info: "border-editor-group-border bg-code",
} as const

export const GroundingHeader = ({
	confidenceScore,
	ambiguityReasoning,
	hasActions,
	risks,
	verifiedEntities,
	constraints,
	constraintExplanations,
}: GroundingHeaderProps) => {
	const percentage = Math.round(confidenceScore * 100)
	const highRisk = risks?.find((r) => r.impact === "high")

	return (
		<details className="lumi-inline-disclosure group mt-3 rounded-md border border-editor-group-border bg-code">
			<summary
				className={cn(
					"lumi-details-trigger list-none cursor-pointer flex items-center gap-2 px-2.5 py-2",
					"hover:bg-accent/10",
				)}>
				<span className="text-[11px] font-medium text-foreground flex-1 min-w-0">How I understood this</span>
				<Badge className="text-[9px] font-normal shrink-0" variant={confidenceVariant(confidenceScore)}>
					{percentage}% sure
				</Badge>
				<ChevronRightIcon
					aria-hidden
					className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
				/>
			</summary>

			<div className="px-2.5 pb-2.5 flex flex-col gap-2 border-t border-editor-group-border/50 pt-2">
				{ambiguityReasoning ? (
					<p className="text-xs text-muted-foreground m-0 leading-snug">{ambiguityReasoning}</p>
				) : null}

				{verifiedEntities && verifiedEntities.length > 0 ? (
					<div className="flex flex-wrap items-center gap-1">
						<span className="text-[10px] text-muted-foreground w-full">Checked paths</span>
						{verifiedEntities.slice(0, 3).map((entity) => (
							<Badge className="text-[9px] font-normal max-w-full truncate" key={entity} variant="outline">
								{entity}
							</Badge>
						))}
						{verifiedEntities.length > 3 ? (
							<Badge className="text-[9px] font-normal" variant="outline">
								+{verifiedEntities.length - 3} more
							</Badge>
						) : null}
					</div>
				) : null}

				{constraints && constraints.length > 0 ? (
					<div className="flex flex-col gap-1.5 pt-1 border-t border-editor-group-border/40">
						<p className="text-[10px] font-medium text-muted-foreground m-0">Keeping in mind</p>
						{constraints.map((constraint, i) => (
							<div key={i}>
								<p className="text-xs font-medium m-0 leading-snug">{constraint}</p>
								{constraintExplanations?.[constraint] ? (
									<p className="text-[10px] text-muted-foreground m-0 mt-0.5 italic leading-snug">
										{constraintExplanations[constraint]}
									</p>
								) : null}
							</div>
						))}
					</div>
				) : null}

				{highRisk ? (
					<div className={cn("flex gap-2 p-2 rounded-md border text-xs leading-snug", alertStyles.danger)}>
						<VscIcon className="shrink-0" name="error" />
						<span>
							<span className="font-medium">Heads up: </span>
							{highRisk.description}
						</span>
					</div>
				) : null}

				{!highRisk && confidenceScore < 0.7 ? (
					<div className={cn("flex gap-2 p-2 rounded-md border text-xs leading-snug", alertStyles.warning)}>
						<VscIcon className="shrink-0" name="warning" />
						<span>I'm not fully confident — double-check the steps below or add a note.</span>
					</div>
				) : null}

				{hasActions && confidenceScore >= 0.7 && !highRisk ? (
					<div className={cn("flex gap-2 p-2 rounded-md border text-xs leading-snug", alertStyles.info)}>
						<VscIcon className="shrink-0" name="info" />
						<span>Review the steps below, then pick an answer.</span>
					</div>
				) : null}
			</div>
		</details>
	)
}

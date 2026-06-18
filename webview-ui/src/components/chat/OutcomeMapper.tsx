import { ChevronRightIcon, MoveRightIcon, ZapIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface OutcomeMapperProps {
	outcomeMapping?: {
		blastRadius?: Array<{ path: string; reason: string }>
		complexityDelta?: {
			linesAdded: number
			linesDeleted: number
			filesCreated: number
		}
		predictedOutcome?: string
	}
}

export const OutcomeMapper = ({ outcomeMapping }: OutcomeMapperProps) => {
	if (!outcomeMapping) return null

	const { blastRadius, complexityDelta, predictedOutcome } = outcomeMapping

	return (
		<details className="lumi-inline-disclosure group mt-3 rounded-md border border-editor-group-border bg-code">
			<summary
				className={cn(
					"lumi-details-trigger list-none cursor-pointer flex items-center gap-2 px-2.5 py-2",
					"hover:bg-accent/10",
				)}>
				<ZapIcon aria-hidden className="size-3.5 shrink-0 text-link" />
				<span className="text-[11px] font-medium text-foreground flex-1 min-w-0">What might change</span>
				<ChevronRightIcon
					aria-hidden
					className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
				/>
			</summary>

			<div className="px-2.5 pb-2.5 flex flex-col gap-2 border-t border-editor-group-border/50 pt-2">
				{predictedOutcome ? (
					<p className="text-xs text-muted-foreground m-0 italic leading-snug">"{predictedOutcome}"</p>
				) : null}

				{complexityDelta ? (
					<div className="flex flex-col gap-1 rounded-md bg-[var(--vscode-editor-inactiveSelectionBackground)] p-2">
						<div className="flex justify-between text-xs">
							<span className="text-muted-foreground">Lines added</span>
							<span className="font-medium text-success tabular-nums">+{complexityDelta.linesAdded}</span>
						</div>
						<div className="flex justify-between text-xs">
							<span className="text-muted-foreground">Lines removed</span>
							<span className="font-medium text-error tabular-nums">-{complexityDelta.linesDeleted}</span>
						</div>
						<div className="flex justify-between text-xs">
							<span className="text-muted-foreground">New files</span>
							<span className="font-medium tabular-nums">{complexityDelta.filesCreated}</span>
						</div>
					</div>
				) : null}

				{blastRadius && blastRadius.length > 0 ? (
					<div className="flex flex-col gap-1.5">
						<p className="text-[10px] font-medium text-muted-foreground m-0">May also touch</p>
						{blastRadius.map((item, i) => (
							<div
								className="flex items-start gap-2 p-2 rounded-md border border-editor-group-border bg-code text-xs"
								key={i}>
								<MoveRightIcon aria-hidden className="size-3 shrink-0 mt-0.5 text-link" />
								<div className="min-w-0">
									<p className="m-0 font-medium text-link truncate" title={item.path}>
										{item.path.split("/").pop()}
									</p>
									<p className="m-0 mt-0.5 text-[10px] text-muted-foreground leading-snug">{item.reason}</p>
								</div>
							</div>
						))}
					</div>
				) : null}
			</div>
		</details>
	)
}

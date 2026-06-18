import { ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface IntentDecompositionProps {
	phases: Array<{
		phase: string
		goal: string
	}>
}

export const IntentDecomposition = ({ phases }: IntentDecompositionProps) => {
	if (!phases || phases.length === 0) return null

	return (
		<details className="lumi-inline-disclosure group mt-2 rounded-md border border-editor-group-border bg-code">
			<summary
				className={cn(
					"lumi-details-trigger list-none cursor-pointer flex items-center gap-2 px-2.5 py-2",
					"hover:bg-accent/10",
				)}>
				<span className="text-[11px] font-medium text-foreground flex-1">Plan breakdown</span>
				<span className="text-[10px] text-muted-foreground shrink-0">{phases.length} steps</span>
				<ChevronRightIcon
					aria-hidden
					className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
				/>
			</summary>

			<ol className="m-0 px-2.5 pb-2.5 pt-1 list-none flex flex-col gap-2 border-t border-editor-group-border/50">
				{phases.map((phase, i) => (
					<li className="flex gap-2 items-start" key={i}>
						<span className="text-[10px] font-medium text-button-foreground bg-button-background px-1.5 py-0.5 rounded shrink-0 min-w-[3.5rem] text-center">
							{phase.phase}
						</span>
						<span className="text-xs text-foreground leading-snug">{phase.goal}</span>
					</li>
				))}
			</ol>
		</details>
	)
}

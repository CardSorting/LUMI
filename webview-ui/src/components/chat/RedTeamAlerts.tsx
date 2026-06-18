import { CheckCircleIcon, ChevronRightIcon, ShieldAlertIcon, ZapOffIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface RedTeamAlertsProps {
	adversarialCritique?: {
		critique: string
		pitfalls: string[]
		mitigations: string[]
		redTeamScore: number
	}
}

export const RedTeamAlerts = ({ adversarialCritique }: RedTeamAlertsProps) => {
	if (!adversarialCritique) return null

	const { critique, pitfalls, mitigations, redTeamScore } = adversarialCritique
	const riskPercent = Math.min(100, Math.max(0, redTeamScore * 100))

	return (
		<details className="lumi-inline-disclosure group mt-3 rounded-md border border-[var(--vscode-inputValidation-errorBorder)] bg-[var(--vscode-inputValidation-errorBackground)]">
			<summary
				className={cn(
					"lumi-details-trigger list-none cursor-pointer flex items-center gap-2 px-2.5 py-2",
					"hover:bg-black/[0.03] dark:hover:bg-white/[0.03]",
				)}>
				<ShieldAlertIcon aria-hidden className="size-3.5 shrink-0 text-error" />
				<span className="text-[11px] font-medium text-foreground flex-1 min-w-0">Things to watch for</span>
				<Badge className="text-[9px] font-normal shrink-0" variant="outline">
					Risk {(redTeamScore * 10).toFixed(1)}/10
				</Badge>
				<ChevronRightIcon
					aria-hidden
					className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
				/>
			</summary>

			<div className="px-2.5 pb-2.5 flex flex-col gap-2 border-t border-[var(--vscode-inputValidation-errorBorder)]/50 pt-2">
				<div className="h-1 w-full rounded-full overflow-hidden bg-editor-group-border">
					<div
						className={cn(
							"h-full transition-[width] duration-300",
							riskPercent > 70 ? "bg-error" : riskPercent > 40 ? "bg-amber-500" : "bg-success",
						)}
						style={{ width: `${riskPercent}%` }}
					/>
				</div>

				<p className="text-xs text-foreground m-0 leading-snug font-medium">"{critique}"</p>

				{pitfalls.length > 0 ? (
					<div className="flex flex-col gap-1">
						<p className="text-[10px] font-medium text-muted-foreground m-0">Possible issues</p>
						{pitfalls.map((pitfall, i) => (
							<div
								className="flex items-start gap-1.5 text-xs p-2 rounded-md border border-error/20 text-error"
								key={i}>
								<ZapOffIcon aria-hidden className="size-3 shrink-0 mt-0.5" />
								<span>{pitfall}</span>
							</div>
						))}
					</div>
				) : null}

				{mitigations.length > 0 ? (
					<div className="flex flex-col gap-1">
						<p className="text-[10px] font-medium text-muted-foreground m-0">Ways to reduce risk</p>
						{mitigations.map((mitigation, i) => (
							<div
								className="flex items-start gap-1.5 text-xs p-2 rounded-md border border-success/20 text-success"
								key={i}>
								<CheckCircleIcon aria-hidden className="size-3 shrink-0 mt-0.5" />
								<span>{mitigation}</span>
							</div>
						))}
					</div>
				) : null}
			</div>
		</details>
	)
}

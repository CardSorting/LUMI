import { memo } from "react"
import { cn } from "@/lib/utils"

interface AuditScoreSparklineProps {
	scores: number[]
	className?: string
}

const SCORE_THRESHOLD = 50

/** Compact score timeline — mirrors GitHub Actions / Datadog metric strip patterns. */
export const AuditScoreSparkline = memo(({ scores, className }: AuditScoreSparklineProps) => {
	if (scores.length < 2) {
		return null
	}

	const max = Math.max(...scores, 100)
	const min = Math.min(...scores, 0)
	const range = Math.max(max - min, 1)

	return (
		<div
			aria-label={`Audit score trend: ${scores.join(", ")}`}
			className={cn("flex items-end gap-0.5 h-3", className)}
			role="img">
			{scores.map((score, index) => {
				const height = Math.max(20, Math.round(((score - min) / range) * 100))
				const passing = score >= SCORE_THRESHOLD
				return (
					<div
						className={cn(
							"w-1 rounded-[1px] transition-all",
							passing ? "bg-emerald-500/60" : score >= SCORE_THRESHOLD - 15 ? "bg-amber-500/55" : "bg-amber-700/45",
						)}
						key={`${index}-${score}`}
						style={{ height: `${height}%` }}
						title={`${score}/100`}
					/>
				)
			})}
		</div>
	)
})

AuditScoreSparkline.displayName = "AuditScoreSparkline"

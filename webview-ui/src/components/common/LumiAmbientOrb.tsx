import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type MiraOrbMood = "idle" | "waiting" | "success" | "still" | "held"
export type MiraCalmTier = "normal" | "long" | "night"

interface MiraAmbientOrbProps {
	children: ReactNode
	className?: string
	mood?: MiraOrbMood
	calmTier?: MiraCalmTier
}

const GLOW_BY_MOOD: Record<MiraOrbMood, string> = {
	idle: "opacity-[0.06] animate-mira-glow-pulse",
	waiting: "opacity-[0.05] animate-mira-glow-pulse [animation-duration:11s]",
	success: "opacity-[0.09] animate-mira-settle",
	still: "opacity-[0.03]",
	held: "opacity-[0.025] animate-mira-glow-pulse [animation-duration:14s]",
}

const DRIFT_BY_MOOD: Record<MiraOrbMood, string> = {
	idle: "animate-mira-drift",
	waiting: "animate-mira-drift [animation-duration:14s]",
	success: "",
	still: "",
	held: "",
}

const BREATHE_BY_MOOD: Record<MiraOrbMood, string> = {
	idle: "animate-mira-breathe",
	waiting: "animate-mira-breathe-rest",
	success: "",
	still: "",
	held: "",
}

const WRAPPER_BY_MOOD: Record<MiraOrbMood, string> = {
	idle: "",
	waiting: "",
	success: "",
	still: "opacity-55",
	held: "opacity-50",
}

/** Quiet ambient presence — grounded, not reactive; rests when still or held. */
export const MiraAmbientOrb = ({ children, className, mood = "idle", calmTier = "normal" }: MiraAmbientOrbProps) => (
	<div
		className={cn(
			"group relative transition-opacity duration-[2s] ease-[cubic-bezier(0.16,1,0.3,1)]",
			WRAPPER_BY_MOOD[mood],
			calmTier === "long" && mood === "waiting" && "opacity-90",
			calmTier === "night" && "opacity-45",
			calmTier === "night" && mood === "still" && "opacity-35",
			className,
		)}
		data-calm-tier={calmTier}
		data-mood={mood}>
		<div
			className={cn(
				"pointer-events-none absolute inset-0 rounded-full blur-3xl transition-opacity duration-[1.6s] bg-premium-mira-glow",
				GLOW_BY_MOOD[mood],
				mood === "idle" && "group-hover:opacity-[0.09]",
				mood === "still" && "opacity-[0.03]",
				calmTier === "long" && mood === "waiting" && "[animation-duration:13s]",
			)}
		/>
		<div
			className={cn(
				"relative transition-transform duration-[1.6s] ease-[cubic-bezier(0.16,1,0.3,1)]",
				DRIFT_BY_MOOD[mood],
				calmTier === "long" && mood === "waiting" && "[animation-duration:16s]",
			)}>
			<div
				className={cn(
					"relative transition-opacity duration-[1.6s]",
					BREATHE_BY_MOOD[mood],
					calmTier === "long" && mood === "waiting" && "[animation-duration:10s]",
				)}>
				{children}
			</div>
		</div>
	</div>
)

import { useCallback, useEffect, useMemo, useState } from "react"
import type { MiraOrbMood } from "@/components/common/MiraAmbientOrb"

const SESSION_START_KEY = "mira-session-start"
const STILL_AFTER_MS = 2 * 60 * 1000
const STILL_AFTER_LONG_MS = 3 * 60 * 1000
const LONG_SESSION_MINUTES = 90
const DEEP_SESSION_MINUTES = 240
const NIGHT_DESK_IDLE_MS = 15 * 60 * 1000

export type SerenityLevel = 0 | 1 | 2 | 3

function getSessionStart(): number {
	if (typeof sessionStorage === "undefined") {
		return Date.now()
	}
	const stored = sessionStorage.getItem(SESSION_START_KEY)
	if (!stored) {
		const now = Date.now()
		sessionStorage.setItem(SESSION_START_KEY, String(now))
		return now
	}
	return Number(stored)
}

function computeSerenityLevel(sessionMinutes: number, isNightDesk: boolean, isLongSession: boolean): SerenityLevel {
	if (isNightDesk && sessionMinutes >= 120) return 3
	if (isNightDesk) return 2
	if (sessionMinutes >= DEEP_SESSION_MINUTES) return 2
	if (isLongSession) return 1
	return 0
}

/** Long-session comfort: stillness, calmer pacing, progressive visual cooling. */
export function useMiraSessionComfort() {
	const sessionStart = useMemo(() => getSessionStart(), [])
	const [lastActivity, setLastActivity] = useState(Date.now())
	const [now, setNow] = useState(Date.now())

	useEffect(() => {
		const tick = window.setInterval(() => setNow(Date.now()), 30_000)
		return () => window.clearInterval(tick)
	}, [])

	useEffect(() => {
		const mark = () => setLastActivity(Date.now())
		window.addEventListener("keydown", mark)
		window.addEventListener("mousedown", mark)
		return () => {
			window.removeEventListener("keydown", mark)
			window.removeEventListener("mousedown", mark)
		}
	}, [])

	const markActivity = useCallback(() => setLastActivity(Date.now()), [])

	const sessionMinutes = Math.floor((now - sessionStart) / 60_000)
	const idleMs = now - lastActivity
	const isLongSession = sessionMinutes >= LONG_SESSION_MINUTES
	const isNightDesk = idleMs >= NIGHT_DESK_IDLE_MS
	const stillThreshold = isLongSession ? STILL_AFTER_LONG_MS : STILL_AFTER_MS
	const isStill = idleMs >= stillThreshold
	const serenityLevel = computeSerenityLevel(sessionMinutes, isNightDesk, isLongSession)

	const calmTier = isNightDesk ? ("night" as const) : isLongSession ? ("long" as const) : ("normal" as const)

	return {
		sessionMinutes,
		isLongSession,
		isNightDesk,
		isStill,
		serenityLevel,
		markActivity,
		calmTier,
	}
}

export function resolveOrbMood(companionMood: MiraOrbMood, isStill: boolean): MiraOrbMood {
	if (companionMood === "held" || companionMood === "waiting" || companionMood === "success") {
		return companionMood
	}
	if (isStill && companionMood === "idle") {
		return "still"
	}
	return companionMood
}

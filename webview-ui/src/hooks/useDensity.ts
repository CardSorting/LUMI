/**
 * useDensity — reactive container-width density system for sidebar ergonomics.
 *
 * Returns the current density tier based on the *webview container* width,
 * not the browser viewport.  VS Code sidebar panels have a constrained width
 * that is independent of the host window dimensions, so media-query breakpoints
 * would fire at the wrong thresholds.
 *
 * Tiers:
 *   comfortable   ≥ 480 px
 *   compact       360–479 px
 *   ultra-compact < 360 px
 *
 * Short-height:
 *   isShortHeight  when container height < 560 px
 */

import { useCallback, useEffect, useRef, useState } from "react"

export type DensityTier = "comfortable" | "compact" | "ultra-compact"

export interface DensityState {
	/** Current density tier derived from container width. */
	density: DensityTier
	/** Raw container width in pixels. */
	width: number
	/** Raw container height in pixels. */
	height: number
	/** True when the container height is below 560px. */
	isShortHeight: boolean
}

function deriveDensity(width: number): DensityTier {
	if (width >= 480) return "comfortable"
	if (width >= 360) return "compact"
	return "ultra-compact"
}

const SHORT_HEIGHT_THRESHOLD = 560

function getDensityElement(): HTMLElement {
	return (document.querySelector("[data-density-container]") as HTMLElement) || document.body
}

export function useDensity(): DensityState {
	const [state, setState] = useState<DensityState>(() => {
		const el = getDensityElement()
		const w = el.clientWidth
		const h = el.clientHeight
		return {
			density: deriveDensity(w),
			width: w,
			height: h,
			isShortHeight: h < SHORT_HEIGHT_THRESHOLD,
		}
	})

	const rafRef = useRef<number>(0)

	const measure = useCallback(() => {
		cancelAnimationFrame(rafRef.current)
		rafRef.current = requestAnimationFrame(() => {
			const el = getDensityElement()
			const w = el.clientWidth
			const h = el.clientHeight
			const density = deriveDensity(w)
			const isShortHeight = h < SHORT_HEIGHT_THRESHOLD

			setState((prev) => {
				if (prev.density === density && prev.width === w && prev.height === h && prev.isShortHeight === isShortHeight) {
					return prev
				}
				return { density, width: w, height: h, isShortHeight }
			})
		})
	}, [])

	useEffect(() => {
		const observer = new ResizeObserver(measure)
		// Observe both body and any data-density-container to catch all resizes.
		observer.observe(document.body)
		const container = document.querySelector("[data-density-container]")
		if (container) {
			observer.observe(container)
		}
		measure()
		return () => {
			cancelAnimationFrame(rafRef.current)
			observer.disconnect()
		}
	}, [measure])

	return state
}

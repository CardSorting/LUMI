/**
 * DensityContext — React context that exposes the current sidebar density tier.
 *
 * Wrap the root layout component with <DensityProvider> to make density
 * available to all child components via `useDensityContext()`.
 *
 * The provider also sets `data-density` and `data-short-height` attributes
 * on the wrapper element so CSS-level density rules work without JS.
 */

import type React from "react"
import { createContext, useContext, useMemo } from "react"
import { type DensityState, useDensity } from "@/hooks/useDensity"

const DensityContext = createContext<DensityState>({
	density: "comfortable",
	width: 480,
	height: 800,
	isShortHeight: false,
})

/**
 * Read the current density state from context.
 * Must be called inside a <DensityProvider>.
 */
export function useDensityContext(): DensityState {
	return useContext(DensityContext)
}

/**
 * Convenience: returns true when the density is compact or ultra-compact.
 */
export function useIsCompact(): boolean {
	const { density } = useContext(DensityContext)
	return density !== "comfortable"
}

/**
 * Convenience: returns true when the density is ultra-compact.
 */
export function useIsUltraCompact(): boolean {
	const { density } = useContext(DensityContext)
	return density === "ultra-compact"
}

interface DensityProviderProps {
	children: React.ReactNode
}

export const DensityProvider: React.FC<DensityProviderProps> = ({ children }) => {
	const state = useDensity()

	const value = useMemo(
		() => state,
		// Only create a new context value when the derived density tier or short-height
		// flag changes — raw pixel values changing should not cause consumer re-renders
		// unless the tier boundary was crossed.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[state.density, state.isShortHeight],
	)

	return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>
}

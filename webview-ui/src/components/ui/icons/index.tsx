import * as React from "react"
import { cn } from "@/lib/utils"
import { CODICONS } from "./codicons"
import { LUCIDE_ICONS } from "./lucide"

/**
 * Unified Icon Component
 *
 * Renders high-quality, inline SVGs for both VS Code Codicons and Lucide icons.
 * This component eliminates runtime dependencies on external icon libraries.
 */

export interface IconProps extends React.SVGProps<SVGSVGElement> {
	name: string
	className?: string
	title?: string
	size?: number | string
	slot?: string
}

export const Icon = React.forwardRef<SVGSVGElement, IconProps>(({ name, className, title, size = 16, ...props }, ref) => {
	// Find icon in either set
	const isLucide = name in LUCIDE_ICONS
	const pathData = LUCIDE_ICONS[name] || CODICONS[name] || CODICONS.question

	// Lucide icons use 24x24, Codicons typically use 16x16
	const viewBox = isLucide ? "0 0 24 24" : "0 0 16 16"

	// Lucide icons work best with stroke, Codicons with fill
	const isStroke = isLucide && !name.toLowerCase().includes("filled")

	const paths = Array.isArray(pathData) ? pathData : [pathData]

	return (
		<svg
			className={cn("shrink-0", className)}
			fill={isStroke ? "none" : "currentColor"}
			height={size}
			ref={ref}
			stroke={isStroke ? "currentColor" : "none"}
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth={isStroke ? "2" : "0"}
			viewBox={viewBox}
			width={size}
			xmlns="http://www.w3.org/2000/svg"
			{...props}>
			{title && <title>{title}</title>}
			{paths.map((d, i) => (
				<path clipRule="evenodd" d={d} fillRule="evenodd" key={i} />
			))}
		</svg>
	)
})

Icon.displayName = "Icon"

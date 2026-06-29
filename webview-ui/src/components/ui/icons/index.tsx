import * as React from "react"
import { cn } from "@/lib/utils"
import { LUCIDE_ICONS } from "./lucide"

/**
 * Unified Icon Component
 *
 * Renders high-quality inline SVGs from a curated Lucide alias map.
 */

export interface IconProps extends React.SVGProps<SVGSVGElement> {
	name: string
	className?: string
	title?: string
	size?: number | string
	slot?: string
}

export const Icon = React.forwardRef<SVGSVGElement, IconProps>(({ name, className, title, size = 16, ...props }, ref) => {
	const LucideIcon = LUCIDE_ICONS[name] ?? LUCIDE_ICONS.question

	return (
		<LucideIcon
			aria-hidden={title ? undefined : true}
			aria-label={title}
			className={cn("shrink-0", className)}
			height={size}
			ref={ref}
			role={title ? "img" : undefined}
			strokeWidth={1.75}
			width={size}
			{...props}>
			{title ? <title>{title}</title> : null}
		</LucideIcon>
	)
})

Icon.displayName = "Icon"

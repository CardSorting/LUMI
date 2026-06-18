import { forwardRef, useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icons"
import { cn } from "@/lib/utils"

interface CopyButtonProps {
	textToCopy?: string
	onCopy?: () => string | undefined | null
	className?: string
	ariaLabel?: string
}

interface WithCopyButtonProps {
	children: React.ReactNode
	textToCopy?: string
	onCopy?: () => string | undefined | null
	/** @deprecated Use variant="overlay" for code blocks only. Chat messages default to inline copy. */
	position?: "top-right" | "bottom-right"
	variant?: "inline" | "overlay"
	style?: React.CSSProperties
	className?: string
	copyButtonClassname?: string
	onMouseUp?: (event: React.MouseEvent<HTMLDivElement>) => void
	ariaLabel?: string
}

const COPIED_TIMEOUT = 1500

const POSITION_CLASSES = {
	"top-right": "top-5 right-5",
	"bottom-right": "bottom-1 right-2",
} as const

/**
 * Base copy button component with clipboard functionality
 */
export const CopyButton: React.FC<CopyButtonProps> = ({ textToCopy, onCopy, className, ariaLabel }) => {
	const [copied, setCopied] = useState(false)

	const handleCopy = useCallback(() => {
		const text = onCopy?.() || textToCopy
		if (!text) {
			return
		}

		navigator.clipboard
			.writeText(text)
			.then(() => {
				setCopied(true)
				setTimeout(() => setCopied(false), COPIED_TIMEOUT)
			})
			.catch((err) => console.error("Copy failed", err))
	}, [textToCopy, onCopy])

	return (
		<Button
			aria-label={copied ? "Copied" : ariaLabel || "Copy"}
			className={cn("scale-90", className)}
			onClick={handleCopy}
			size="icon"
			variant="icon">
			{copied ? <Icon className="size-2" name="CheckCheckIcon" /> : <Icon className="size-2" name="CopyIcon" />}
		</Button>
	)
}

/**
 * Wraps content with copy — inline footer by default (no hover overlay in narrow sidebars).
 */
export const WithCopyButton = forwardRef<HTMLDivElement, WithCopyButtonProps>(
	(
		{
			children,
			textToCopy,
			onCopy,
			position = "top-right",
			variant = "inline",
			style,
			className,
			copyButtonClassname,
			onMouseUp,
			ariaLabel,
			...props
		},
		ref,
	) => {
		const hasCopyFunctionality = !!(textToCopy || onCopy)

		if (variant === "overlay") {
			return (
				<div className={cn("relative w-full", className)} onMouseUp={onMouseUp} ref={ref} style={style} {...props}>
					{children}
					{hasCopyFunctionality && (
						<div className={cn("absolute", POSITION_CLASSES[position], copyButtonClassname)}>
							<CopyButton ariaLabel={ariaLabel} onCopy={onCopy} textToCopy={textToCopy} />
						</div>
					)}
				</div>
			)
		}

		return (
			<div className={cn("flex flex-col w-full", className)} ref={ref} style={style} {...props}>
				<div className="relative min-w-0" onMouseUp={onMouseUp}>
					{children}
				</div>
				{hasCopyFunctionality && (
					<div className="flex justify-end pt-0.5">
						<CopyButton
							ariaLabel={ariaLabel || "Copy message"}
							className={cn("scale-75 opacity-70 hover:opacity-100", copyButtonClassname)}
							onCopy={onCopy}
							textToCopy={textToCopy}
						/>
					</div>
				)}
			</div>
		)
	},
)

WithCopyButton.displayName = "WithCopyButton"

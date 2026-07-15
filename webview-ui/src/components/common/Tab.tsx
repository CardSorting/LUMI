import React, { forwardRef, HTMLAttributes, useCallback } from "react"
import { cn } from "@/lib/utils"

type TabProps = HTMLAttributes<HTMLDivElement>

export const Tab = ({ className, children, ...props }: TabProps) => (
	<div className={cn("flex h-full w-full flex-col", className)} {...props}>
		{children}
	</div>
)

export const TabHeader = ({ className, children, ...props }: TabProps) => (
	<div className={cn("border-b border-(--vscode-panel-border) px-5 py-2.5", className)} {...props}>
		{children}
	</div>
)

export const TabContent = ({ className, children, ...props }: TabProps) => {
	const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
		const target = e.target as HTMLElement

		// Prevent scrolling if the target or any of its ancestors is a listbox or option
		if (target.closest('[role="listbox"], [role="combobox"], [role="option"]')) {
			return
		}

		e.currentTarget.scrollTop += e.deltaY
	}, [])

	return (
		<div className={cn("flex-1 overflow-auto", className)} {...props} onWheel={onWheel}>
			{children}
		</div>
	)
}

export const TabList = forwardRef<
	HTMLDivElement,
	HTMLAttributes<HTMLDivElement> & {
		value: string
		onValueChange: (value: string) => void
	}
>(({ children, className, value, onValueChange, onKeyDown, ...props }, ref) => {
	const handleTabSelect = useCallback(
		(tabValue: string) => {
			onValueChange(tabValue)
		},
		[onValueChange],
	)

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			onKeyDown?.(event)
			if (event.defaultPrevented) return

			const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'))
			if (tabs.length === 0) return

			const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement)
			const isVertical = event.currentTarget.getAttribute("aria-orientation") === "vertical"
			let nextIndex: number | undefined

			if (event.key === "Home") nextIndex = 0
			else if (event.key === "End") nextIndex = tabs.length - 1
			else if ((!isVertical && event.key === "ArrowRight") || (isVertical && event.key === "ArrowDown")) {
				nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % tabs.length
			} else if ((!isVertical && event.key === "ArrowLeft") || (isVertical && event.key === "ArrowUp")) {
				nextIndex = currentIndex <= 0 ? tabs.length - 1 : currentIndex - 1
			}

			if (nextIndex === undefined) return
			event.preventDefault()
			tabs[nextIndex]?.focus()
			tabs[nextIndex]?.click()
		},
		[onKeyDown],
	)

	return (
		<div className={cn("flex", className)} onKeyDown={handleKeyDown} ref={ref} role="tablist" {...props}>
			{React.Children.map(children, (child) => {
				if (React.isValidElement(child)) {
					const tab = child as React.ReactElement<{
						value: string
						isSelected?: boolean
						onSelect?: () => void
					}>
					return React.cloneElement(tab, {
						isSelected: tab.props.value === value,
						onSelect: () => handleTabSelect(tab.props.value),
					})
				}
				return child
			})}
		</div>
	)
})

export const TabTrigger = forwardRef<
	HTMLButtonElement,
	React.ButtonHTMLAttributes<HTMLButtonElement> & {
		value: string
		isSelected?: boolean
		onSelect?: () => void
	}
>(({ children, className, value, isSelected, onSelect, onClick, ...props }, ref) => {
	const id = props.id ?? `lumi-tab-${value}`
	const controls = props["aria-controls"] ?? `lumi-tabpanel-${value}`

	return (
		<button
			aria-controls={controls}
			aria-selected={isSelected}
			className={cn(
				"focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--vscode-focusBorder)]",
				className,
			)}
			data-value={value}
			id={id}
			onClick={(event) => {
				onClick?.(event)
				if (!event.defaultPrevented) onSelect?.()
			}}
			ref={ref}
			role="tab"
			tabIndex={isSelected ? 0 : -1}
			type="button"
			{...props}>
			{children}
		</button>
	)
})

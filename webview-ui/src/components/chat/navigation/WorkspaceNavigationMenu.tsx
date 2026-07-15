import { Check, Menu } from "lucide-react"
import { useCallback, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icons"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { CHAT_MENU_ITEMS, type ChatNavItemId } from "./chatNavConfig"

interface WorkspaceNavigationMenuProps {
	activePanel: ChatNavItemId | null
	onNavigate: (id: ChatNavItemId) => void
}

/**
 * Labeled overflow navigation for destinations that do not fit in the narrow
 * sidebar app bar. The direct history shortcut stays visible in the toolbar;
 * this menu makes every destination discoverable by name and description.
 */
export const WorkspaceNavigationMenu = ({ activePanel, onNavigate }: WorkspaceNavigationMenuProps) => {
	const [isOpen, setIsOpen] = useState(false)
	const menuRef = useRef<HTMLDivElement>(null)

	const getMenuItems = useCallback(
		() => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
		[],
	)

	const focusItem = useCallback(
		(index: number) => {
			const items = getMenuItems()
			if (items.length === 0) return
			items[(index + items.length) % items.length]?.focus()
		},
		[getMenuItems],
	)

	const handleMenuKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			const items = getMenuItems()
			const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)

			switch (event.key) {
				case "ArrowDown":
					event.preventDefault()
					focusItem(currentIndex + 1)
					break
				case "ArrowUp":
					event.preventDefault()
					focusItem(currentIndex <= 0 ? items.length - 1 : currentIndex - 1)
					break
				case "Home":
					event.preventDefault()
					focusItem(0)
					break
				case "End":
					event.preventDefault()
					focusItem(items.length - 1)
					break
				case "Tab":
					setIsOpen(false)
					break
			}
		},
		[focusItem, getMenuItems],
	)

	const handleSelect = useCallback(
		(id: ChatNavItemId) => {
			setIsOpen(false)
			onNavigate(id)
		},
		[onNavigate],
	)

	return (
		<Popover onOpenChange={setIsOpen} open={isOpen}>
			<PopoverTrigger asChild>
				<Button
					aria-haspopup="menu"
					aria-label="Menu"
					className="h-8 min-w-8 gap-1.5 rounded-md px-2 text-foreground/80 transition-colors hover:bg-toolbar-hover hover:text-foreground focus-visible:ring-2"
					data-testid="chat-nav-menu"
					title="Menu"
					variant="icon">
					<Menu aria-hidden className="size-4" strokeWidth={1.75} />
					<span className="hidden text-[11px] font-medium leading-none min-[260px]:inline">Menu</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				aria-label="Workspace navigation"
				className="w-[min(17rem,calc(100vw-1rem))] rounded-md p-1.5"
				collisionPadding={8}
				onKeyDown={handleMenuKeyDown}
				onOpenAutoFocus={(event) => {
					event.preventDefault()
					requestAnimationFrame(() => {
						const items = getMenuItems()
						const activeIndex = CHAT_MENU_ITEMS.findIndex((item) => item.id === activePanel)
						items[Math.max(activeIndex, 0)]?.focus()
					})
				}}
				ref={menuRef}
				role="menu"
				sideOffset={5}>
				<p className="m-0 px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-description">Go to</p>
				{CHAT_MENU_ITEMS.map((item) => {
					const isActive = activePanel === item.id
					return (
						<button
							aria-current={isActive ? "page" : undefined}
							className={cn(
								"flex min-h-10 w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-foreground outline-none",
								"hover:bg-list-hover focus-visible:bg-list-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--vscode-focusBorder)]",
								isActive && "bg-selection-inactive",
							)}
							key={item.id}
							onClick={() => handleSelect(item.id)}
							role="menuitem"
							type="button">
							<Icon className="text-foreground/80" name={item.icon} size={17} />
							<span className="min-w-0 flex-1">
								<span className="block text-xs font-medium leading-tight">{item.label}</span>
								<span className="mt-0.5 block truncate text-[10px] leading-tight text-description">
									{item.description}
								</span>
							</span>
							{isActive ? <Check aria-hidden className="size-3.5 shrink-0" /> : null}
						</button>
					)
				})}
			</PopoverContent>
		</Popover>
	)
}

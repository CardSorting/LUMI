import { Check, Menu } from "lucide-react"
import { useCallback, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icons"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { type ChatNavItem, type ChatNavItemId } from "./chatNavConfig"

interface WorkspaceNavigationMenuProps {
	activePanel: ChatNavItemId | null
	onNavigate: (id: ChatNavItemId) => void
	menuItems: ChatNavItem[]
}

/**
 * Labeled overflow navigation for destinations that do not fit in the narrow
 * sidebar app bar.
 */
export const WorkspaceNavigationMenu = ({ activePanel, onNavigate, menuItems }: WorkspaceNavigationMenuProps) => {
	const { platform } = useExtensionState()
	const [isOpen, setIsOpen] = useState(false)
	const menuRef = useRef<HTMLDivElement>(null)
	const isMac = platform === "darwin"

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
				className={cn(
					"w-[min(17rem,calc(100vw-1rem))] rounded-xl p-2 shadow-2xl border border-border/40 bg-popover text-popover-foreground outline-none",
					"data-[state=open]:animate-in data-[state=closed]:animate-out",
					"data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
					"data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
					"data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
					"duration-150 ease-out",
				)}
				collisionPadding={8}
				onKeyDown={handleMenuKeyDown}
				onOpenAutoFocus={(event) => {
					event.preventDefault()
					requestAnimationFrame(() => {
						const items = getMenuItems()
						const activeIndex = menuItems.findIndex((item) => item.id === activePanel)
						items[Math.max(activeIndex, 0)]?.focus()
					})
				}}
				ref={menuRef}
				role="menu"
				sideOffset={5}>
				{(() => {
					const chatSection = menuItems.filter((item) => ["newChat", "chat", "history"].includes(item.id))
					const devSection = menuItems.filter((item) => ["tools", "worktrees"].includes(item.id))
					const prefSection = menuItems.filter((item) => ["account", "settings"].includes(item.id))

					const renderSection = (title: string, itemsList: typeof menuItems) => {
						if (itemsList.length === 0) return null
						return (
							<div className="flex flex-col gap-0.5">
								<p className="m-0 px-2 pb-1 pt-1.5 text-[9px] font-bold uppercase tracking-wider text-description/60 select-none">
									{title}
								</p>
								{itemsList.map((item) => {
									const isActive = activePanel === item.id
									const shortcut = isMac ? item.shortcutMac : item.shortcutWin
									return (
										<button
											aria-current={isActive ? "page" : undefined}
											className={cn(
												"flex min-h-[38px] w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-foreground outline-none transition-colors",
												"hover:bg-list-hover focus-visible:bg-list-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--vscode-focusBorder)]",
												isActive &&
													"bg-selection-inactive font-medium text-[var(--vscode-button-background)]",
											)}
											key={item.id}
											onClick={() => handleSelect(item.id)}
											role="menuitem"
											type="button">
											<Icon
												className={cn(
													"text-foreground/70",
													isActive && "text-[var(--vscode-button-background)]",
												)}
												name={item.icon}
												size={15}
											/>
											<span className="min-w-0 flex-1">
												<span className="block text-xs leading-tight">{item.label}</span>
												<span className="mt-0.5 block truncate text-[10px] leading-tight text-description/70 font-normal">
													{item.description}
												</span>
											</span>
											<div className="flex items-center gap-1.5 shrink-0 ml-auto pl-2">
												{shortcut && (
													<span
														className={cn(
															"text-[9px] font-mono tracking-wide select-none",
															isActive
																? "text-[var(--vscode-button-background)]/70"
																: "text-description/50",
														)}>
														{shortcut}
													</span>
												)}
												{isActive && (
													<Check
														aria-hidden
														className="size-3.5 shrink-0 text-[var(--vscode-button-background)]"
													/>
												)}
											</div>
										</button>
									)
								})}
							</div>
						)
					}

					return (
						<>
							{chatSection.length > 0 && renderSection("Conversation", chatSection)}
							{chatSection.length > 0 && (devSection.length > 0 || prefSection.length > 0) && (
								<div className="h-px bg-border/20 my-1" />
							)}
							{devSection.length > 0 && renderSection("Workspace", devSection)}
							{devSection.length > 0 && prefSection.length > 0 && <div className="h-px bg-border/20 my-1" />}
							{prefSection.length > 0 && renderSection("Preferences", prefSection)}
						</>
					)
				})()}
			</PopoverContent>
		</Popover>
	)
}

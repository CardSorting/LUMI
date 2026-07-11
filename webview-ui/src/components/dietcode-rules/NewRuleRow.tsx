import { CreateHookRequest, CreateSkillRequest, RuleFileRequest } from "@shared/proto/index.dietcode"
import { Loader2, PlusIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useClickAway } from "react-use"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"

interface NewRuleRowProps {
	isGlobal: boolean
	ruleType?: string
	existingHooks?: string[]
	workspaceName?: string
	onSuccess?: () => void
	existingNames?: string[]
}

const HOOK_TYPES = [
	{ name: "TaskStart", description: "Executes when a new task begins" },
	{ name: "TaskResume", description: "Executes when a task is resumed" },
	{ name: "TaskCancel", description: "Executes when a task is cancelled" },
	{ name: "TaskComplete", description: "Executes when a task completes" },
	{ name: "PreToolUse", description: "Executes before any tool is used" },
	{ name: "PostToolUse", description: "Executes after any tool is used" },
	{ name: "UserPromptSubmit", description: "Executes when user submits a prompt" },
	{ name: "PreCompact", description: "Executes before conversation compaction" },
]

const NewRuleRow: React.FC<NewRuleRowProps> = ({
	isGlobal,
	ruleType,
	existingHooks = [],
	workspaceName,
	onSuccess,
	existingNames,
}) => {
	const [isExpanded, setIsExpanded] = useState(false)
	const [filename, setFilename] = useState("")
	const inputRef = useRef<HTMLInputElement>(null)
	const [error, setError] = useState<string | null>(null)
	const [isCreating, setIsCreating] = useState(false)

	const componentRef = useRef<HTMLDivElement>(null)

	// Calculate available hook types by filtering out existing hooks
	const availableHookTypes = useMemo(() => HOOK_TYPES.filter((type) => !existingHooks.includes(type.name)), [existingHooks])

	// Focus the input when expanded
	useEffect(() => {
		if (isExpanded && inputRef.current) {
			inputRef.current.focus()
		}
	}, [isExpanded])

	useClickAway(componentRef, () => {
		if (isExpanded) {
			setIsExpanded(false)
			setFilename("")
			setError(null)
		}
	})

	const getExtension = (filename: string): string => {
		if (filename.startsWith(".") && !filename.includes(".", 1)) {
			return ""
		}
		const match = filename.match(/\.[^.]+$/)
		return match ? match[0].toLowerCase() : ""
	}

	const isValidExtension = (ext: string): boolean => {
		return ext === "" || ext === ".md" || ext === ".txt"
	}

	const handleCreateHook = async (hookName: string) => {
		if (!hookName || isCreating) return

		setIsCreating(true)
		setError(null)
		try {
			await FileServiceClient.createHook(
				CreateHookRequest.create({
					hookName,
					isGlobal,
					workspaceName,
				}),
			)
			onSuccess?.()
		} catch (err) {
			console.error("Error creating hook:", err)
			setError(err instanceof Error ? err.message : "Failed to create hook")
		} finally {
			setIsCreating(false)
		}
	}

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		if (isCreating) return

		const trimmedFilename = filename.trim()
		if (!trimmedFilename) {
			setError("Name cannot be empty")
			return
		}

		// Check for duplicates (case-insensitive, considering potential auto-appended extensions)
		if (existingNames) {
			const lowerName = trimmedFilename.toLowerCase()
			const lowerMd = (trimmedFilename + ".md").toLowerCase()
			const isDuplicate = existingNames.some((name) => {
				const lowerExisting = name.toLowerCase()
				return lowerExisting === lowerName || lowerExisting === lowerMd
			})

			if (isDuplicate) {
				setError(`A ${ruleType || "rule"} with this name already exists`)
				return
			}
		}

		// Skills use directory names, not file extensions
		if (ruleType === "skill") {
			// Validate skill name - only allow alphanumeric, dashes, underscores
			if (!/^[a-zA-Z0-9_-]+$/.test(trimmedFilename)) {
				setError("Skill name can only contain letters, numbers, dashes, and underscores")
				return
			}

			setIsCreating(true)
			setError(null)
			try {
				await FileServiceClient.createSkillFile(
					CreateSkillRequest.create({
						skillName: trimmedFilename,
						isGlobal,
					}),
				)
				setFilename("")
				setIsExpanded(false)
				onSuccess?.()
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to create skill")
			} finally {
				setIsCreating(false)
			}
			return
		}

		const extension = getExtension(trimmedFilename)

		if (!isValidExtension(extension)) {
			setError("Only .md, .txt, or no file extension allowed")
			return
		}

		let finalFilename = trimmedFilename
		if (extension === "") {
			finalFilename = `${trimmedFilename}.md`
		}

		setIsCreating(true)
		setError(null)
		try {
			await FileServiceClient.createRuleFile(
				RuleFileRequest.create({
					isGlobal,
					filename: finalFilename,
					type: ruleType || "dietcode",
				}),
			)
			setFilename("")
			setIsExpanded(false)
			onSuccess?.()
		} catch (err) {
			console.error("Error creating rule file:", err)
			setError(err instanceof Error ? err.message : "Failed to create rule file")
		} finally {
			setIsCreating(false)
		}
	}

	const _handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			setIsExpanded(false)
			setFilename("")
		}
	}

	return (
		<div
			className={cn("mb-2.5 transition-all duration-300 ease-in-out", {
				"opacity-100": isExpanded,
				"opacity-70 hover:opacity-100": !isExpanded,
			})}
			onClick={() => !isExpanded && ruleType !== "hook" && setIsExpanded(true)}
			ref={componentRef}>
			<div
				className={cn(
					"flex items-center px-2 py-4 rounded bg-input-background transition-all duration-300 ease-in-out h-5",
					{
						"shadow-sm": isExpanded,
					},
				)}>
				{ruleType === "hook" ? (
					<>
						<label className="sr-only" htmlFor="hook-type-select">
							Select hook type to create
						</label>
						<span className="sr-only" id="hook-select-description">
							Choose a hook type to create. Hooks execute at specific points in LUMI's lifecycle. Available:{" "}
							{availableHookTypes.map((h) => h.name).join(", ")}
						</span>
						<select
							aria-describedby="hook-select-description"
							aria-label="Select hook type to create"
							className="flex-1 bg-input-background text-input-foreground border-0 outline-0 rounded focus:outline-none focus:ring-0 focus:border-transparent px-2 cursor-pointer"
							disabled={availableHookTypes.length === 0 || isCreating}
							id="hook-type-select"
							onChange={(e) => {
								if (e.target.value) {
									handleCreateHook(e.target.value)
									// Reset selection after creating
									e.target.value = ""
								}
							}}
							style={{
								fontStyle: "italic",
								appearance: "none",
								backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23cccccc' d='M6 9L1 4h10z'/%3E%3C/svg%3E")`,
								backgroundRepeat: "no-repeat",
								backgroundPosition: "right 8px center",
								paddingRight: "24px",
							}}
							value="">
							<option disabled value="">
								{availableHookTypes.length === 0 ? "All hooks created" : "New hook..."}
							</option>
							{availableHookTypes.map((hook) => (
								<option key={hook.name} title={hook.description} value={hook.name}>
									{hook.name}
								</option>
							))}
						</select>
					</>
				) : (
					<form className="flex flex-1 items-center" onSubmit={handleSubmit}>
						<input
							className={cn(
								"flex-1 bg-input-background text-input-foreground border-0 outline-0 rounded focus:outline-none focus:ring-0 focus:border-transparent",
								{
									italic: !isExpanded,
									"opacity-50": isCreating,
								},
							)}
							disabled={isCreating}
							onChange={(e) => {
								setFilename(e.target.value)
								if (error) setError(null)
							}}
							placeholder={
								isExpanded
									? ruleType === "workflow"
										? "workflow-name (.md, .txt, or no extension)"
										: ruleType === "skill"
											? "skill-name (letters, numbers, dashes, underscores)"
											: "rule-name (.md, .txt, or no extension)"
									: ruleType === "workflow"
										? "New workflow file..."
										: ruleType === "skill"
											? "New skill..."
											: "New rule file..."
							}
							ref={inputRef}
							type="text"
							value={isExpanded ? filename : ""}
						/>

						<Button
							aria-label={
								isExpanded
									? ruleType === "skill"
										? "Create skill"
										: "Create file"
									: ruleType === "workflow"
										? "New workflow file..."
										: ruleType === "skill"
											? "New skill..."
											: "New rule file..."
							}
							className="mx-0.5"
							disabled={isCreating}
							onClick={(e) => {
								e.stopPropagation()
								if (!isExpanded) {
									setIsExpanded(true)
								}
							}}
							size="icon"
							title={isExpanded ? (ruleType === "skill" ? "Create skill" : "Create file") : "New file"}
							type={isExpanded ? "submit" : "button"}
							variant="icon">
							{isCreating ? <Loader2 className="animate-spin h-4 w-4 text-foreground" /> : <PlusIcon />}
						</Button>
					</form>
				)}
			</div>
			{isExpanded && error && <div className="text-error text-xs mt-1 ml-2">{error}</div>}
		</div>
	)
}

export default NewRuleRow

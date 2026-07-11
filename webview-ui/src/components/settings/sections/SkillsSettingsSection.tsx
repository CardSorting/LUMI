import { EmptyRequest } from "@shared/proto/dietcode/common"
import { SkillInfo, ToggleSkillRequest } from "@shared/proto/dietcode/file"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { FileServiceClient } from "@/services/grpc-client"
import NewRuleRow from "../../dietcode-rules/NewRuleRow"
import RuleRow from "../../dietcode-rules/RuleRow"
import Section from "../Section"

interface SkillsSettingsSectionProps {
	renderSectionHeader?: (tabId: string) => JSX.Element | null
}

const SkillsSettingsSection = ({ renderSectionHeader }: SkillsSettingsSectionProps) => {
	const [globalSkills, setGlobalSkills] = useState<SkillInfo[]>([])
	const [localSkills, setLocalSkills] = useState<SkillInfo[]>([])
	const [searchQuery, setSearchQuery] = useState("")

	const refreshSkills = () => {
		FileServiceClient.refreshSkills({} as EmptyRequest)
			.then((response) => {
				setGlobalSkills(response.globalSkills || [])
				setLocalSkills(response.localSkills || [])
			})
			.catch((error) => {
				console.error("Failed to refresh skills:", error)
			})
	}

	useEffect(() => {
		refreshSkills()
		// Poll every 5 seconds to automatically pick up filesystem changes
		const pollInterval = setInterval(refreshSkills, 5000)
		return () => clearInterval(pollInterval)
	}, [])

	const toggleSkill = (isGlobal: boolean, skillPath: string, enabled: boolean) => {
		FileServiceClient.toggleSkill(
			ToggleSkillRequest.create({
				skillPath,
				isGlobal,
				enabled,
			}),
		)
			.then(() => {
				// Refresh the lists immediately for responsive state update
				refreshSkills()
			})
			.catch((error) => {
				console.error("Error toggling skill:", error)
			})
	}

	const filteredGlobalSkills = globalSkills.filter(
		(skill) =>
			skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
			skill.path.toLowerCase().includes(searchQuery.toLowerCase()),
	)

	const filteredLocalSkills = localSkills.filter(
		(skill) =>
			skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
			skill.path.toLowerCase().includes(searchQuery.toLowerCase()),
	)

	return (
		<div>
			{renderSectionHeader?.("skills")}
			<Section>
				<div className="flex flex-col gap-4">
					<p className="text-xs text-(--vscode-descriptionForeground)">
						Skills are executable playbooks LUMI loads automatically when a task matches. Configure, toggle, or add
						new skills below.
					</p>

					{/* Search input field */}
					<div className="flex flex-col gap-2 mt-1">
						<VSCodeTextField
							onInput={(e: any) => setSearchQuery(e.target.value)}
							placeholder="Search skills..."
							style={{ width: "100%" }}
							value={searchQuery}
						/>
					</div>

					{/* Global Skills Section */}
					<div className="flex flex-col gap-2 mt-2">
						<span className="text-sm" style={{ fontWeight: 600 }}>
							Global Skills
						</span>
						<div className="flex flex-col gap-1">
							{filteredGlobalSkills.length === 0 ? (
								<p className="text-xs text-(--vscode-descriptionForeground) italic">
									{searchQuery ? `No global skills matching "${searchQuery}"` : "No global skills found."}
								</p>
							) : (
								filteredGlobalSkills
									.sort((a, b) => a.name.localeCompare(b.name))
									.map((skill) => (
										<RuleRow
											enabled={skill.enabled}
											isGlobal={true}
											key={skill.path}
											onDeleteSkill={refreshSkills}
											rulePath={skill.path}
											ruleType="skill"
											toggleRule={(path, enabled) => toggleSkill(true, path, enabled)}
										/>
									))
							)}
							{!searchQuery && <NewRuleRow isGlobal={true} onSuccess={refreshSkills} ruleType="skill" />}
						</div>
					</div>

					{/* Workspace Skills Section */}
					<div className="flex flex-col gap-2 mt-4">
						<span className="text-sm" style={{ fontWeight: 600 }}>
							Workspace Skills
						</span>
						<div className="flex flex-col gap-1">
							{filteredLocalSkills.length === 0 ? (
								<p className="text-xs text-(--vscode-descriptionForeground) italic">
									{searchQuery ? `No workspace skills matching "${searchQuery}"` : "No workspace skills found."}
								</p>
							) : (
								filteredLocalSkills
									.sort((a, b) => a.name.localeCompare(b.name))
									.map((skill) => (
										<RuleRow
											enabled={skill.enabled}
											isGlobal={false}
											key={skill.path}
											onDeleteSkill={refreshSkills}
											rulePath={skill.path}
											ruleType="skill"
											toggleRule={(path, enabled) => toggleSkill(false, path, enabled)}
										/>
									))
							)}
							{!searchQuery && <NewRuleRow isGlobal={false} onSuccess={refreshSkills} ruleType="skill" />}
						</div>
					</div>
				</div>
			</Section>
		</div>
	)
}

export default SkillsSettingsSection

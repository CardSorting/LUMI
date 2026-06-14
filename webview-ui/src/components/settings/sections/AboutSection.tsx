import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import Section from "../Section"

interface AboutSectionProps {
	version: string
	renderSectionHeader: (tabId: string) => JSX.Element | null
}
const AboutSection = ({ version, renderSectionHeader }: AboutSectionProps) => {
	return (
		<div>
			{renderSectionHeader("about")}
			<Section>
				<div className="flex px-4 flex-col gap-2">
					<h2 className="text-lg font-semibold">LUMI v{version}</h2>
					<p>
						A friendly AI companion for coding. LUMI helps with edits, terminal commands, browser tasks, and more —
						always when you're ready.
					</p>

					<h3 className="text-md font-semibold">Community & Support</h3>
					<p>
						<VSCodeLink href="https://x.com/dietcode">X</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://discord.gg/dietcode">Discord</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://www.reddit.com/r/dietcode/"> r/dietcode</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">Development</h3>
					<p>
						<VSCodeLink href="https://github.com/dietcode/dietcode">GitHub</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/dietcode/dietcode/issues"> Issues</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/dietcode/dietcode/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop">
							{" "}
							Feature Requests
						</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">Resources</h3>
					<p>
						<VSCodeLink href="https://docs.dietcode.bot/">Documentation</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://dietcode.bot/">https://dietcode.bot</VSCodeLink>
					</p>
				</div>
			</Section>
		</div>
	)
}

export default AboutSection

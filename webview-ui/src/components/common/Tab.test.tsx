/// <reference types="@testing-library/jest-dom" />
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it } from "vitest"
import { TabContent, TabList, TabTrigger } from "./Tab"

const TabHarness = () => {
	const [value, setValue] = useState("models")
	return (
		<>
			<TabList aria-label="Settings sections" onValueChange={setValue} value={value}>
				<TabTrigger value="models">Models</TabTrigger>
				<TabTrigger value="preferences">Preferences</TabTrigger>
				<TabTrigger value="about">About</TabTrigger>
			</TabList>
			<TabContent aria-labelledby={`lumi-tab-${value}`} id={`lumi-tabpanel-${value}`} role="tabpanel">
				{value}
			</TabContent>
		</>
	)
}

const NestedTabHarness = () => {
	const [value, setValue] = useState("models")
	return (
		<>
			<TabList aria-label="Settings sections" onValueChange={setValue} value={value}>
				<div>
					<h3>Category 1</h3>
					<div>
						<TabTrigger value="models">Models</TabTrigger>
					</div>
				</div>
				<div>
					<h3>Category 2</h3>
					<div>
						<TabTrigger value="preferences">Preferences</TabTrigger>
					</div>
				</div>
			</TabList>
			<TabContent aria-labelledby={`lumi-tab-${value}`} id={`lumi-tabpanel-${value}`} role="tabpanel">
				{value}
			</TabContent>
		</>
	)
}

describe("Tab keyboard navigation", () => {
	it("uses roving focus and activates adjacent tabs with arrow keys", async () => {
		const user = userEvent.setup()
		render(<TabHarness />)

		const models = screen.getByRole("tab", { name: "Models" })
		const preferences = screen.getByRole("tab", { name: "Preferences" })
		expect(models).toHaveAttribute("aria-selected", "true")
		expect(preferences).toHaveAttribute("tabindex", "-1")

		models.focus()
		await user.keyboard("{ArrowRight}")

		expect(preferences).toHaveFocus()
		expect(preferences).toHaveAttribute("aria-selected", "true")
		expect(screen.getByRole("tabpanel")).toHaveTextContent("preferences")
	})
})

describe("Nested Tab triggers", () => {
	it("supports switching tabs even when triggers are nested under helper layout elements", async () => {
		const user = userEvent.setup()
		render(<NestedTabHarness />)

		const models = screen.getByRole("tab", { name: "Models" })
		const preferences = screen.getByRole("tab", { name: "Preferences" })
		expect(models).toHaveAttribute("aria-selected", "true")
		expect(preferences).toHaveAttribute("aria-selected", "false")

		await user.click(preferences)

		expect(preferences).toHaveAttribute("aria-selected", "true")
		expect(models).toHaveAttribute("aria-selected", "false")
		expect(screen.getByRole("tabpanel")).toHaveTextContent("preferences")
	})
})

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import * as settingsHandlers from "@/components/settings/utils/settingsHandlers"
import { ModModeSwitcher } from "./ModModeSwitcher"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		modEnabled: false,
		modOutcome: "plan-and-implement",
	}),
}))

vi.mock("@/components/settings/utils/settingsHandlers", () => ({
	updateSetting: vi.fn(),
}))

describe("ModModeSwitcher ergonomics & accessibility", () => {
	it("renders Coding and Design buttons with default Coding active", () => {
		render(<ModModeSwitcher />)

		const codingBtn = screen.getByTestId("coding-mode-button")
		const designBtn = screen.getByTestId("design-mode-button")

		expect(codingBtn).toBeInTheDocument()
		expect(designBtn).toBeInTheDocument()

		expect(codingBtn).toHaveAttribute("aria-selected", "true")
		expect(designBtn).toHaveAttribute("aria-selected", "false")
	})

	it("switches to Design mode when Design button is clicked", async () => {
		const user = userEvent.setup()
		const updateSettingSpy = vi.spyOn(settingsHandlers, "updateSetting")

		render(<ModModeSwitcher />)

		const designBtn = screen.getByTestId("design-mode-button")
		await user.click(designBtn)

		expect(updateSettingSpy).toHaveBeenCalledWith("modEnabled", true)
	})

	it("switches to Coding mode when Coding button is clicked", async () => {
		const user = userEvent.setup()
		const updateSettingSpy = vi.spyOn(settingsHandlers, "updateSetting")

		render(<ModModeSwitcher />)

		const codingBtn = screen.getByTestId("coding-mode-button")
		await user.click(codingBtn)

		expect(updateSettingSpy).toHaveBeenCalledWith("modEnabled", false)
	})

	it("handles keyboard navigation between modes", async () => {
		const user = userEvent.setup()
		const updateSettingSpy = vi.spyOn(settingsHandlers, "updateSetting")

		render(<ModModeSwitcher />)

		const tablist = screen.getByRole("tablist")
		tablist.focus()

		await user.keyboard("{ArrowRight}")
		expect(updateSettingSpy).toHaveBeenCalledWith("modEnabled", true)

		await user.keyboard("{ArrowLeft}")
		expect(updateSettingSpy).toHaveBeenCalledWith("modEnabled", false)
	})
})

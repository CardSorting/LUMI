import { expect } from "@playwright/test"
import { E2E_WORKSPACE_TYPES, e2e } from "./utils/helpers"

e2e.describe("Diff Editor", () => {
	e2e.describe.configure({ timeout: 120_000 })

	E2E_WORKSPACE_TYPES.forEach(({ title, workspaceType }) => {
		e2e.extend({
			workspaceType,
		})(title, async ({ helper, page, sidebar }) => {
			await helper.signin(sidebar)

			const inputbox = sidebar.getByTestId("chat-input")
			await expect(inputbox).toBeVisible()

			await inputbox.fill("edit_request")
			await expect(inputbox).toHaveValue("edit_request")
			await sidebar.getByTestId("send-button").click({ delay: 50 })
			await expect(inputbox).toHaveValue("")
			await helper.waitForUserMessage(sidebar, "edit_request")

			const approvalPrompt = sidebar.getByText(/Want me to apply these changes\?|Save these changes\?|I updated this file:/)
			await expect(approvalPrompt).toBeVisible({ timeout: 90_000 })

			const applyButton = sidebar.getByRole("button", { name: /Apply changes|Go ahead/ })
			if (await applyButton.isVisible({ timeout: 5000 }).catch(() => false)) {
				await applyButton.click()
			}

			await expect(page.getByText("test.ts: Original ↔ DietCode's")).toBeVisible({ timeout: 30000 })

			const diffEditor = page.locator(
				".monaco-editor.modified-in-monaco-diff-editor > .overflow-guard > .monaco-scrollable-element.editor-scrollable > .lines-content > div:nth-child(4)",
			)
			await diffEditor.click()
			await expect(diffEditor).toBeVisible()

			await page.close()
		})
	})
})

import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Chat - can send messages", async ({ helper, sidebar, page }) => {
	// Sign in
	await helper.signin(sidebar)

	// Submit a message
	const inputbox = sidebar.getByTestId("chat-input")
	await expect(inputbox).toBeVisible()
	await inputbox.fill("Hello, DietCode!")
	await expect(inputbox).toHaveValue("Hello, DietCode!")
	await sidebar.getByTestId("send-button").click()
	await expect(inputbox).toHaveValue("")
	await helper.waitForUserMessage(sidebar, "Hello, DietCode!")

	await sidebar.getByRole("button", { name: "New chat" }).click()
	await expect(inputbox).toBeVisible()

	// Makes sure chat input and send still work after starting a task
	await inputbox.fill("Follow-up after new task")
	await expect(inputbox).toHaveValue("Follow-up after new task")
	await inputbox.fill("")

	// === slash commands preserve following text ===
	await expect(inputbox).toHaveValue("")
	// Type partial slash command to trigger menu
	await inputbox.fill("/newt")

	// Wait for menu to be visible and click on menu item
	await inputbox.focus()
	await sidebar.getByText("newtask", { exact: false }).click()
	await expect(inputbox).toHaveValue("/newtask ")

	// Add following text to verify it works correctly
	await inputbox.pressSequentially("following text should be preserved")
	await expect(inputbox).toHaveValue("/newtask following text should be preserved")

	// === @ mentions preserve following text ===
	await inputbox.fill("")
	await expect(inputbox).toHaveValue("")

	// Type partial @ mention to trigger menu
	await inputbox.fill("@prob")

	// Wait for menu to be visible and click on menu item
	await sidebar.getByText("Problems", { exact: false }).first().click()
	await expect(inputbox).toHaveValue("@problems ")

	// Add following text to verify it works correctly
	await inputbox.pressSequentially("following text should be preserved")
	await expect(inputbox).toHaveValue("@problems following text should be preserved")

	await page.close()
})

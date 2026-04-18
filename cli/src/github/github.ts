import * as core from "@actions/core"
import * as github from "@actions/github"
import { Octokit } from "@octokit/rest"
import type {
	IssueCommentEvent,
	PullRequestEvent,
	PullRequestReviewCommentEvent,
	WorkflowDispatchEvent,
} from "@octokit/webhooks-types"
import type { Controller } from "@/core/controller"
import { printError, printInfo, style } from "../utils/display"

export class GithubRunner {
	private octokit: Octokit
	private context = github.context

	constructor(token: string) {
		this.octokit = new Octokit({ auth: token })
	}

	async run(controller: Controller, runTask: (prompt: string, options: any, ctx: any) => Promise<any>): Promise<void> {
		const { eventName, payload } = this.context
		printInfo(`Processing GitHub event: ${style.bold(eventName)}`)

		try {
			let prompt = ""
			let issueNumber: number | undefined

			switch (eventName) {
				case "issue_comment": {
					const commentPayload = payload as IssueCommentEvent
					if (commentPayload.action === "deleted") return

					issueNumber = commentPayload.issue.number
					const body = commentPayload.comment.body
					if (!body.includes("@dietcode")) return

					if (!issueNumber) return
					await this.addReaction(issueNumber, commentPayload.comment.id, "eyes")
					prompt = `Responding to comment on issue #${issueNumber}:\n\n${body}\n\nIssue Title: ${commentPayload.issue.title}\nIssue Body: ${commentPayload.issue.body}`
					break
				}

				case "pull_request": {
					const prPayload = payload as PullRequestEvent
					issueNumber = prPayload.pull_request.number

					if (prPayload.action === "opened" || prPayload.action === "synchronize") {
						prompt = `Auditing Pull Request #${issueNumber}: ${prPayload.pull_request.title}\n\nDescription:\n${prPayload.pull_request.body}\n\nPlease review the changes and ensure architectural integrity.`
					}
					break
				}

				case "pull_request_review_comment": {
					const reviewPayload = payload as PullRequestReviewCommentEvent
					issueNumber = reviewPayload.pull_request.number
					const body = reviewPayload.comment.body

					if (body.includes("@dietcode")) {
						if (!issueNumber) return
						await this.addReaction(issueNumber, reviewPayload.comment.id, "eyes")
						prompt = `Responding to review comment on PR #${issueNumber} in file ${reviewPayload.comment.path}:\n\n${body}`
					}
					break
				}

				case "workflow_dispatch": {
					const dispatchPayload = payload as WorkflowDispatchEvent
					prompt = `Manual workflow dispatch triggered. How can I assist with the repository?`
					break
				}

				default:
					printInfo(`Event ${eventName} is not currently handled with specific logic.`)
					return
			}

			if (prompt) {
				printInfo(style.success("Prompt generated. Starting autonomous task..."))
				const result = await runTask(prompt, { act: true, yolo: true }, { controller })

				if (issueNumber) {
					await this.postComment(
						issueNumber,
						`### DietCode Task Completed\n\n${result?.summary || "Task finished successfully."}`,
					)
				}
			}
		} catch (error) {
			printError(`GitHub Action execution failed: ${error instanceof Error ? error.message : String(error)}`)
			core.setFailed(error instanceof Error ? error.message : String(error))
		}
	}

	private async addReaction(issueNumber: number, commentId: number, content: "eyes" | "rocket" | "heart" | "+1") {
		try {
			await this.octokit.rest.reactions.createForIssueComment({
				...this.context.repo,
				comment_id: commentId,
				content,
			})
		} catch (error) {
			printError(`Failed to add reaction: ${error}`)
		}
	}

	private async postComment(issueNumber: number, body: string) {
		try {
			await this.octokit.rest.issues.createComment({
				...this.context.repo,
				issue_number: issueNumber,
				body,
			})
		} catch (error) {
			printError(`Failed to post comment: ${error}`)
		}
	}
}

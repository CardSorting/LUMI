#!/usr/bin/env node
/**
 * npm workspace self-link helpers for Open VSX packaging (lumi-vscode ↔ lumi).
 */
import fs from "node:fs"
import path from "node:path"

export function createWorkspaceLinkManager({ repoRoot, nodeModulesPath }) {
	function resolveSymlinkTarget(linkPath) {
		const target = fs.readlinkSync(linkPath)
		return path.resolve(path.dirname(linkPath), target)
	}

	function isExpectedWorkspaceSelfLink(linkPath) {
		try {
			if (!fs.lstatSync(linkPath).isSymbolicLink()) {
				return false
			}
			return resolveSymlinkTarget(linkPath) === path.resolve(repoRoot)
		} catch {
			return false
		}
	}

	function reconcile({ fromName, toName }) {
		const fromPath = path.join(nodeModulesPath, fromName)
		const toPath = path.join(nodeModulesPath, toName)

		if (!fs.existsSync(nodeModulesPath)) {
			throw new Error("node_modules not found — run npm install before packaging")
		}

		if (fs.existsSync(toPath)) {
			if (!isExpectedWorkspaceSelfLink(toPath)) {
				throw new Error(`Unexpected path at ${toPath}; expected workspace symlink to ${repoRoot}`)
			}
			return false
		}

		if (fs.existsSync(fromPath)) {
			if (!isExpectedWorkspaceSelfLink(fromPath)) {
				throw new Error(`Unexpected path at ${fromPath}; expected workspace symlink to ${repoRoot}`)
			}
			fs.renameSync(fromPath, toPath)
			return true
		}

		fs.symlinkSync(repoRoot, toPath, "dir")
		if (!isExpectedWorkspaceSelfLink(toPath)) {
			throw new Error(`Failed to create expected workspace symlink at ${toPath}`)
		}
		return true
	}

	function restore({ fromName, toName, didReconcile }) {
		if (!didReconcile) {
			return
		}

		const fromPath = path.join(nodeModulesPath, fromName)
		const toPath = path.join(nodeModulesPath, toName)

		if (fs.existsSync(toPath) && !fs.existsSync(fromPath)) {
			if (!isExpectedWorkspaceSelfLink(toPath)) {
				throw new Error(`Refusing to restore: unexpected path at ${toPath}`)
			}
			fs.renameSync(toPath, fromPath)
		}
	}

	return { reconcile, restore }
}

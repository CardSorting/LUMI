import type { IController as Controller } from "@core/controller/types"
import { PathHashMap } from "@shared/proto/dietcode/checkpoints"
import { StringArrayRequest } from "@shared/proto/dietcode/common"
import { hashWorkingDir } from "@/integrations/checkpoints/CheckpointUtils"

export async function getCwdHash(_controller: Controller, request: StringArrayRequest): Promise<PathHashMap> {
	const pathHash: Record<string, string> = {}

	for (const path of request.value) {
		try {
			pathHash[path] = hashWorkingDir(path)
		} catch {
			pathHash[path] = ""
		}
	}

	return PathHashMap.create({ pathHash })
}

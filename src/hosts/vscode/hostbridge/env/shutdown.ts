import { Empty, EmptyRequest } from "@shared/proto/codemarie/common"

export async function shutdown(_request: EmptyRequest): Promise<Empty> {
	// VSCode extensions cannot shutdown the host process (VSCode itself)
	// This is a no-op that just returns success
	// The shutdown RPC is primarily used by standalone codemarie-core instances
	// to tell their paired host bridge processes to shut down
	return Empty.create({})
}

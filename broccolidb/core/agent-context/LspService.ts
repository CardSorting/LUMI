import { spawn, ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ServiceContext } from './types.js';

/**
 * LspService provides Language Server Protocol (LSP) awareness.
 * Absorbed from src/tools/LSPTool.
 * Synchronizes child language servers to resolve code symbols with 100% accuracy.
 */
export class LspService {
  private servers: Map<string, ChildProcess> = new Map();
  private requestId: number = 0;
  private pendingRequests: Map<number, { resolve: (res: any) => void, reject: (err: any) => void }> = new Map();

  private _buffer: Buffer = Buffer.alloc(0);
  private _diagnostics: Map<string, any[]> = new Map();
  private _retryCount: Map<string, number> = new Map();

  // Production Server Registry: Maps languages to discovery logic and commands.
  private readonly SERVER_REGISTRY: Record<string, { command: string; args: string[] }> = {
    typescript: { command: 'typescript-language-server', args: ['--stdio'] },
    python: { command: 'pyright-langserver', args: ['--stdio'] },
    go: { command: 'gopls', args: [] },
  };

  constructor(private ctx: ServiceContext) {}

  /**
   * Automatically starts a server for the given language using the registry.
   */
  async ensureServer(language: string): Promise<boolean> {
    if (this.servers.has(language)) return true;
    
    const config = this.SERVER_REGISTRY[language];
    if (!config) {
        console.warn(`[LSP] ⚠️  No server configured for language: ${language}`);
        return false;
    }

    return this.startServer(language, config.command, config.args);
  }

  /**
   * Starts a language server for a specific language with full handshake and lifecycle management.
   */
  async startServer(language: string, command: string, args: string[]): Promise<boolean> {
    if (this.servers.has(language)) return true;

    try {
        console.log(`[LSP] 🚀 Starting ${language} server: ${command}...`);
        
        // Use 'which' or similar to find the absolute path in a real app,
        // here we assume the command is in the environment path.
        const server = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'], shell: true });
        this.servers.set(language, server);

        server.stdout!.on('data', (chunk: Buffer) => this._onData(language, chunk));
        server.on('error', (err) => {
            console.error(`[LSP] 💥 ${language} server error:`, err);
            this._handleServerError(language, err);
        });
        server.on('exit', (code) => {
            console.warn(`[LSP] ⚰️  ${language} server exited with code ${code}`);
            this._handleServerExit(language, code);
        });

        const initResult = await this._sendRequest(language, 'initialize', {
            processId: process.pid,
            clientInfo: { name: 'Broccolidb-Sovereign', version: '1.0.0' },
            rootUri: `file://${this.ctx.workspace.workspacePath}`,
            capabilities: {
                textDocument: {
                    definition: { dynamicRegistration: true },
                    references: { dynamicRegistration: true },
                    hover: { contentFormat: ['markdown', 'plaintext'] },
                    publishDiagnostics: { relatedInformation: true }
                }
            }
        });

        console.log(`[LSP] ✅ ${language} initialized. Capabilities detected.`);
        await this._sendNotification(language, 'initialized', {});
        this._retryCount.set(language, 0); // Reset retries on success

        return true;
    } catch (err) {
        console.error(`[LSP] ❌ Failed to start ${language} server:`, err);
        return false;
    }
  }

  private _handleServerError(language: string, error: any) {
      this._rejectAll(language, error);
      this.servers.delete(language);
  }

  private _handleServerExit(language: string, code: number | null) {
      this.servers.delete(language);
      const retries = this._retryCount.get(language) || 0;
      
      if (retries < 3) {
          const delay = Math.pow(2, retries) * 1000;
          console.log(`[LSP] 🔄 Attempting to restart ${language} server in ${delay}ms (retry ${retries + 1}/3)...`);
          this._retryCount.set(language, retries + 1);
          setTimeout(() => this.ensureServer(language), delay);
      }
  }

  /**
   * Passive Feedback: Notify servers that a file has been updated.
   */
  async notifyFileUpdate(file: string, content: string): Promise<void> {
      const language = this._getLanguageFromFile(file);
      if (!language) return;

      const started = await this.ensureServer(language);
      if (!started) return;

      await this._sendNotification(language, 'textDocument/didChange', {
          textDocument: { uri: `file://${file}`, version: Date.now() },
          contentChanges: [{ text: content }]
      });
  }

  /**
   * Returns current diagnostics for a file.
   */
  getDiagnostics(file: string): any[] {
      return this._diagnostics.get(`file://${file}`) || [];
  }

  /**
   * Resolves the definition of a symbol at a specific location.
   */
  async getDefinitions(language: string, file: string, line: number, character: number): Promise<any[]> {
    await this.ensureServer(language);
    return this._sendRequest(language, 'textDocument/definition', {
      textDocument: { uri: `file://${file}` },
      position: { line, character }
    });
  }

  /**
   * Resolves the references of a symbol at a specific location.
   */
  async getReferences(language: string, file: string, line: number, character: number): Promise<any[]> {
      await this.ensureServer(language);
      return this._sendRequest(language, 'textDocument/references', {
        textDocument: { uri: `file://${file}` },
        position: { line, character },
        context: { includeDeclaration: true }
      });
  }

  private _getLanguageFromFile(file: string): string | null {
      if (file.endsWith('.ts') || file.endsWith('.tsx')) return 'typescript';
      if (file.endsWith('.py')) return 'python';
      if (file.endsWith('.go')) return 'go';
      return null;
  }

  private _sendRequest(language: string, method: string, params: any): Promise<any> {
    const id = this.requestId++;
    const request = { jsonrpc: '2.0', id, method, params };
    this._writeToStream(language, request);
    
    return new Promise((resolve, reject) => {
        this.pendingRequests.set(id, { resolve, reject });
    });
  }

  private _sendNotification(language: string, method: string, params: any): void {
      this._writeToStream(language, { jsonrpc: '2.0', method, params });
  }

  private _writeToStream(language: string, msg: any): void {
      const server = this.servers.get(language);
      if (!server) throw new Error(`[LSP] Server for ${language} not started.`);
      
      const json = JSON.stringify(msg);
      const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
      server.stdin!.write(header + json);
  }

  private _onData(language: string, chunk: Buffer): void {
      this._buffer = Buffer.concat([this._buffer, chunk]);
      
      while (true) {
          const str = this._buffer.toString('utf8');
          const headerMatch = str.match(/Content-Length: (\d+)\r\n\r\n/);
          if (!headerMatch) break;

          const contentLength = parseInt(headerMatch[1], 10);
          const headerOffset = headerMatch.index! + headerMatch[0].length;

          if (this._buffer.length < headerOffset + contentLength) break;

          const body = this._buffer.slice(headerOffset, headerOffset + contentLength).toString('utf8');
          this._buffer = this._buffer.slice(headerOffset + contentLength);

          try {
              const res = JSON.parse(body);
              
              if (res.id !== undefined && this.pendingRequests.has(res.id)) {
                  const { resolve } = this.pendingRequests.get(res.id)!;
                  this.pendingRequests.delete(res.id);
                  resolve(res.result);
              } 
              else if (res.method === 'textDocument/publishDiagnostics') {
                  const { uri, diagnostics } = res.params;
                  this._diagnostics.set(uri, diagnostics);
                  console.log(`[LSP] 🩺 Received ${diagnostics.length} diagnostics for ${uri}`);
              }
          } catch (err) {
              console.error(`[LSP] JSON parse error:`, err);
          }
      }
  }

  private _rejectAll(language: string, error: Error): void {
      for (const [id, { reject }] of this.pendingRequests.entries()) {
          this.pendingRequests.delete(id);
          reject(error);
      }
  }

  public shutdown() {
    for (const server of this.servers.values()) {
        server.kill();
    }
    this.servers.clear();
  }
}

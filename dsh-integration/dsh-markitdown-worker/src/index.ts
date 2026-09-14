/**
 * Provider for the `ctx.markitdown` seam — dual-mode transport.
 *
 * transportMode (cordis.yml):
 *  - 'collect'     (default): one Python process per request via the batch
 *                  stdin shape (`stdio.stdin = {data}`) + bounded collected
 *                  stdout read after `done`. No streaming-handle dependency.
 *  - 'interactive': long-lived NDJSON worker over piped raw streams
 *                  (`handle.stdin` Writable / `handle.stdout` Readable) —
 *                  VERIFIED against source (packages/subprocess/subprocess/src/types.ts:
 *                  SubprocessHandle exposes raw streams when spawned 'pipe').
 *
 * Source-verified contract (Step 6b, dsh-subprocess types.ts):
 *  - SubprocessSpawnSpec = { argv, cwd, stdio, graceMs, signal?, env? }
 *  - env entries MERGE onto the implementation's scrubbed parent base
 *    (the 约束 doc's "full override" claim is outdated).
 *  - Handle: done: Promise<SubprocessOutcome>, terminate(), collected readers.
 *    No kill(), no exitCode promise.
 */
import type { Context } from '@deepseek-ai/cordis'
// Declaration-merge sources: these pull the ctx.<key> typings for the injected
// services (subprocess/sandbox keys + timer mixin) without runtime imports.
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/cordis-plugin-timer'
import Schema from '@deepseek-ai/schemastery'
import {
  MarkitdownService,
  MarkitdownUnavailableError,
  MarkitdownDependencyError,
  MarkitdownUnsupportedFormatError,
  MarkitdownConversionFailedError,
  type MarkitdownConvertOptions,
  type MarkitdownResult,
  type MarkitdownBatchResult,
  type MarkitdownHealth,
} from '@kiwifruit/dsh-markitdown'

export const name = 'dsh-markitdown-worker'
export const inject = ['subprocess', 'sandbox', 'timer'] as const

const PLUGIN_INTERFACE_VERSION = 1
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface BridgeErrorPayload {
  code: string
  message: string
  attempts?: Array<{ converter: string; message: string }>
}

type SubprocessStdio = {
  stdin: 'ignore' | 'pipe' | { readonly data: string }
  stdout: 'pipe' | 'inherit' | { readonly maxBytes: number }
  stderr: 'pipe' | 'inherit' | { readonly maxBytes: number }
}

/** Source-verified SubprocessSpawnSpec (packages/subprocess/subprocess/src/types.ts:75). */
interface SpawnSpec {
  argv: readonly string[]
  cwd: string
  stdio: SubprocessStdio
  graceMs: number
  env?: Record<string, string | undefined> | undefined
  signal?: AbortSignal | undefined
}

interface SubprocessOutcome {
  exitCode: number | null
  signal: string | null
}

/** Source-verified SubprocessHandle (types.ts:167). */
interface SubprocessHandleLike {
  readonly stdin: { write(line: string): void; end?(): void } | undefined
  readonly stdout: AsyncIterable<unknown> | undefined
  readonly stderr: AsyncIterable<unknown> | undefined
  readonly collected: {
    readonly stdout?: { readFrom(fromByte: number): { text: string; lossy: boolean } }
    readonly stderr?: { readFrom(fromByte: number): { text: string; lossy: boolean } }
  }
  readonly done: Promise<SubprocessOutcome>
  terminate(): void
  waitForExit(signal?: AbortSignal): Promise<boolean>
}

interface BridgeTransport {
  convert(source: string, ocr: MarkitdownConvertOptions['ocr'], signal: AbortSignal | undefined, timeoutMs: number | undefined): Promise<MarkitdownResult>
  convertBatch(sources: string[], ocr: MarkitdownConvertOptions['ocr'], signal: AbortSignal | undefined, timeoutMs: number | undefined): Promise<MarkitdownBatchResult>
  health(signal: AbortSignal | undefined): Promise<MarkitdownHealth>
  dispose(): void
}

function failFromBridge(err: BridgeErrorPayload): Error {
  switch (err.code) {
    case 'MARKITDOWN_DEPENDENCY':
      return new MarkitdownDependencyError(err.message)
    case 'MARKITDOWN_UNSUPPORTED_FORMAT':
      return new MarkitdownUnsupportedFormatError(err.message)
    case 'MARKITDOWN_CONVERSION_FAILED':
      return new MarkitdownConversionFailedError(err.message, err.attempts)
    case 'MARKITDOWN_VERSION_MISMATCH':
    case 'MARKITDOWN_UNAVAILABLE':
    default:
      return new MarkitdownUnavailableError(err.message)
  }
}

/**
 * Fail-Closed path fence (约束/01-架构认知/17-fail-closed安全模型详解).
 *
 * An EMPTY allow-list denies every local path: "no roots configured" must be a
 * detectable denial, never a silent pass-through. URI schemes are filtered out
 * by the caller (SCHEME_RE) and never reach this fence.
 */
function assertPathAllowed(path: string, roots: string[]): void {
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  const allowed = roots.some((root) => {
    const r = root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    return normalized === r || normalized.startsWith(r + '/')
  })
  if (!allowed) {
    // Same denial shape as the fs fence so the model sees one consistent boundary.
    throw new MarkitdownConversionFailedError('[sandbox: file access denied outside allowed read roots]')
  }
}

function assertLocalPaths(sources: string[], roots: string[]): void {
  for (const s of sources) {
    if (s && !SCHEME_RE.test(s)) assertPathAllowed(s, roots)
  }
}

function parseReply<T>(text: string): T {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const reply = JSON.parse(lines[i]) as ({ ok: true; result: T } | { ok: false; error: BridgeErrorPayload }) & { event?: string }
      if (reply && typeof reply === 'object' && 'ok' in reply) {
        if (reply.ok) return reply.result
        throw failFromBridge(reply.error)
      }
    } catch (e) {
      if (e instanceof MarkitdownUnavailableError || e instanceof MarkitdownDependencyError || e instanceof MarkitdownUnsupportedFormatError || e instanceof MarkitdownConversionFailedError) throw e
      continue // non-protocol line (warnings etc.) — keep scanning upward
    }
  }
  throw new MarkitdownUnavailableError('bridge produced no protocol reply')
}

// ---------------------------------------------------------------------------
// Collect transport (default) — one process per request, batch stdin shape
// ---------------------------------------------------------------------------

class CollectTransport implements BridgeTransport {
  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {}

  private buildSpec(request: string): SpawnSpec {
    const bridgeDir = `${this.config.vendorPath.replace(/\\/g, '/')}/bridge`
    const argv = [this.config.pythonPath, '-m', 'markitdown_bridge.single']
    // Fail-Closed: confine() throws (SANDBOX_UNAVAILABLE) when unavailable —
    // we never spawn unconfined. Policy is carried PER CALL (source-verified):
    // SandboxPolicy = { mode, workspaceRoot }.
    const confined = this.ctx.sandbox.confine(argv, { mode: 'read-only', workspaceRoot: bridgeDir })
    return {
      argv: confined.argv,
      cwd: bridgeDir,
      stdio: {
        // Batch shape: write the whole request and close fd 0 (types.ts:37-39).
        stdin: { data: request },
        stdout: { maxBytes: this.config.collectStdoutBytes },
        stderr: { maxBytes: this.config.collectStderrBytes },
      },
      graceMs: this.config.terminateGraceMs,
      // Merged onto the implementation's scrubbed parent base (types.ts:100-108).
      env: { ...this.config.workerEnv, PYTHONUTF8: '1' },
    }
  }

  private async runOnce<T>(op: string, params: Record<string, unknown>, signal: AbortSignal | undefined, timeoutMs: number): Promise<T> {
    const request = JSON.stringify({
      op,
      params,
      pluginInterfaceVersion: PLUGIN_INTERFACE_VERSION,
      expectedVendorVersion: this.config.expectedVendorVersion || null,
    })
    const handle = (await this.ctx.subprocess.spawn(this.buildSpec(request))) as unknown as SubprocessHandleLike

    // Exit vs timeout vs abort — timeout/abort terminate the managed range.
    const timer = this.ctx.timeout(timeoutMs).then(() => 'timeout' as const)
    const abortPromise = signal
      ? new Promise<'aborted'>((resolve) => {
          if (signal.aborted) resolve('aborted')
          else signal.addEventListener('abort', () => resolve('aborted'), { once: true })
        })
      : new Promise<never>(() => {})
    const outcome = await Promise.race([handle.done.then(() => 'exited' as const), timer, abortPromise])
    if (outcome !== 'exited') {
      handle.terminate()
      throw outcome === 'timeout'
        ? new MarkitdownUnavailableError(`bridge request timed out after ${timeoutMs}ms`)
        : new DOMException('The operation was aborted.', 'AbortError')
    }

    // Collected streams stay readable after settlement (types.ts:106-110).
    const reader = handle.collected.stdout
    if (!reader) {
      throw new MarkitdownUnavailableError('bridge handle exposes no collected stdout (unexpected provider shape)')
    }
    const read = reader.readFrom(0)
    if (read.lossy) {
      throw new MarkitdownUnavailableError(
        `bridge reply exceeded the collect cap (${this.config.collectStdoutBytes} bytes); raise collectStdoutBytes`,
      )
    }
    return parseReply<T>(read.text)
  }

  async convert(source: string, ocr: MarkitdownConvertOptions['ocr'], signal: AbortSignal | undefined, timeoutMs: number | undefined): Promise<MarkitdownResult> {
    return this.runOnce<MarkitdownResult>('convert', { source, kwargs: ocr ? { ocr } : {} }, signal, timeoutMs ?? this.config.timeoutMs)
  }

  async convertBatch(sources: string[], ocr: MarkitdownConvertOptions['ocr'], signal: AbortSignal | undefined, timeoutMs: number | undefined): Promise<MarkitdownBatchResult> {
    // Batch runs in ONE process, sequential over the items list.
    return this.runOnce<MarkitdownBatchResult>('convert_batch', { sources, kwargs: ocr ? { ocr } : {} }, signal, timeoutMs ?? this.config.timeoutMs * Math.max(1, sources.length))
  }

  async health(): Promise<MarkitdownHealth> {
    // Probe = one real single-shot init round-trip (no persistent worker to ping).
    try {
      await this.runOnce('init', {}, undefined, this.config.healthTimeoutMs)
      return { ok: true, pending: 0 }
    } catch {
      return { ok: false, pending: 0 }
    }
  }

  dispose(): void {
    // Per-request processes: nothing persistent to clean up.
  }
}

// ---------------------------------------------------------------------------
// Interactive transport — long-lived NDJSON worker (source-verified feasible)
// ---------------------------------------------------------------------------

interface PendingEntry {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  cleanup: () => void
}

class InteractiveTransport implements BridgeTransport {
  private worker: SubprocessHandleLike | null = null
  private nextId = 0
  private pending = new Map<string, PendingEntry>()
  private crashed = false
  private restartedOnce = false

  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {}

  private buildSpec(): SpawnSpec {
    const bridgeDir = `${this.config.vendorPath.replace(/\\/g, '/')}/bridge`
    const argv = [this.config.pythonPath, '-m', 'markitdown_bridge', String(this.config.maxConcurrent)]
    const confined = this.ctx.sandbox.confine(argv, { mode: 'read-only', workspaceRoot: bridgeDir })
    return {
      argv: confined.argv,
      cwd: bridgeDir,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: this.config.terminateGraceMs,
      env: { ...this.config.workerEnv, PYTHONUTF8: '1' },
    }
  }

  private async ensureWorker(): Promise<SubprocessHandleLike> {
    if (this.worker && !this.crashed) return this.worker
    if (this.crashed) {
      // `restartOnCrash` gates the revive path; when enabled, exactly one lazy
      // restart is allowed (a second consecutive crash is terminal, no crash loop).
      // The budget resets only on a healthy handshake.
      if (!this.config.restartOnCrash) {
        throw new MarkitdownUnavailableError(
          'bridge worker crashed; restartOnCrash is disabled — service disabled',
        )
      }
      if (this.restartedOnce) {
        throw new MarkitdownUnavailableError('bridge worker crashed again after restart; service disabled')
      }
      this.restartedOnce = true
    }
    const worker = (await this.ctx.subprocess.spawn(this.buildSpec())) as unknown as SubprocessHandleLike
    this.worker = worker

    void worker.done.then((outcome) => {
      if (this.worker !== worker) return // already replaced by a newer instance
      this.crashed = true
      this.worker = null
      const err = new MarkitdownUnavailableError(`bridge worker exited unexpectedly (code=${String(outcome.exitCode)})`)
      for (const [, p] of this.pending) p.reject(err)
      this.pending.clear()
    })

    void this.readLoop(worker)

    // Handshake is part of bring-up: version mismatch fails the first request
    // path (Fail-Closed) instead of corrupting later conversions.
    await this.rawRequest(worker, 'init', {
      pluginInterfaceVersion: PLUGIN_INTERFACE_VERSION,
      expectedVendorVersion: this.config.expectedVendorVersion || null,
    }, this.config.handshakeTimeoutMs)
    this.restartedOnce = false
    return worker
  }

  private async readLoop(worker: SubprocessHandleLike): Promise<void> {
    if (!worker.stdout) return
    const decoder = new TextDecoder()
    try {
      for await (const chunk of worker.stdout) {
        const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk as Uint8Array)
        for (const raw of text.split('\n')) {
          const line = raw.trim()
          if (!line) continue
          let frame: ({ ok: true; result: unknown } | { ok: false; error: BridgeErrorPayload }) & { id?: string; event?: string }
          try {
            frame = JSON.parse(line) as ({ ok: true; result: unknown } | { ok: false; error: BridgeErrorPayload }) & { id?: string; event?: string }
          } catch {
            continue // non-protocol line; bridge writes diagnostics to stderr only
          }
          if (frame.event === 'ready') continue
          if (typeof frame.id !== 'string') continue
          const entry = this.pending.get(frame.id)
          if (!entry) continue
          this.pending.delete(frame.id)
          entry.cleanup()
          if (frame.ok) entry.resolve(frame.result)
          else entry.reject(failFromBridge(frame.error))
        }
      }
    } catch {
      // stdout closed — exit handler above rejects pending requests.
    }
  }

  private rawRequest(worker: SubprocessHandleLike, op: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const id = `h${++this.nextId}`
    return new Promise<unknown>((resolve, reject) => {
      const timer = this.ctx.timeout(timeoutMs).then(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        reject(new MarkitdownUnavailableError(`bridge handshake timed out after ${timeoutMs}ms`))
      })
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        cleanup: () => {
          void timer
        },
      })
      worker.stdin?.write(JSON.stringify({ id, op, params }) + '\n')
    })
  }

  private async request<T>(op: string, params: Record<string, unknown>, signal: AbortSignal | undefined, timeoutMs: number | undefined): Promise<T> {
    const worker = await this.ensureWorker()
    const id = `r${++this.nextId}`
    const effectiveTimeout = timeoutMs ?? this.config.timeoutMs
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        // Cooperative cancel: queued requests are dropped; running ones finish —
        // documented boundary of the synchronous Python core.
        try {
          worker.stdin?.write(JSON.stringify({ id: `cancel-${id}`, op: 'cancel', params: { targetId: id } }) + '\n')
        } catch {
          /* worker already dead; exit handler will reject pending */
        }
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      const timer = this.ctx.timeout(effectiveTimeout).then(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        signal?.removeEventListener('abort', onAbort)
        reject(new MarkitdownUnavailableError(`bridge request timed out after ${effectiveTimeout}ms`))
      })

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        cleanup: () => {
          signal?.removeEventListener('abort', onAbort)
          void timer
        },
      })
      worker.stdin?.write(JSON.stringify({ id, op, params }) + '\n')
    })
  }

  async convert(source: string, ocr: MarkitdownConvertOptions['ocr'], signal: AbortSignal | undefined, timeoutMs: number | undefined): Promise<MarkitdownResult> {
    return this.request<MarkitdownResult>('convert', { source, kwargs: ocr ? { ocr } : {} }, signal, timeoutMs)
  }

  async convertBatch(sources: string[], ocr: MarkitdownConvertOptions['ocr'], signal: AbortSignal | undefined, timeoutMs: number | undefined): Promise<MarkitdownBatchResult> {
    return this.request<MarkitdownBatchResult>('convert_batch', { sources, kwargs: ocr ? { ocr } : {} }, signal, timeoutMs)
  }

  async health(signal: AbortSignal | undefined): Promise<MarkitdownHealth> {
    return this.request<MarkitdownHealth>('health', {}, signal, this.config.healthTimeoutMs)
  }

  dispose(): void {
    if (this.worker) {
      try {
        this.worker.terminate()
      } finally {
        this.worker = null
      }
    }
    const err = new MarkitdownUnavailableError('bridge worker disposed')
    for (const [, p] of this.pending) p.reject(err)
    this.pending.clear()
  }
}

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

class WorkerMarkitdownService extends MarkitdownService {
  private transport: BridgeTransport

  constructor(
    ctx: Context,
    private readonly config: Config,
  ) {
    super(ctx)
    this.transport =
      config.transportMode === 'interactive'
        ? new InteractiveTransport(ctx, config)
        : new CollectTransport(ctx, config)
  }

  async convert(source: string, options?: MarkitdownConvertOptions, signal?: AbortSignal): Promise<MarkitdownResult> {
    // URI schemes (http/https/file/data) bypass the local-root check; local paths do not.
    if (source && !SCHEME_RE.test(source)) assertPathAllowed(source, this.config.allowedReadRoots)
    const result = await this.transport.convert(source, options?.ocr, signal, options?.timeoutMs)
    this.ctx.emit('markitdown/converted', {
      source: result.meta.source,
      chars: result.meta.chars,
      title: result.title,
      ocr: Boolean(options?.ocr),
    })
    return result
  }

  async convertBatch(
    sources: string[],
    options?: MarkitdownConvertOptions,
    signal?: AbortSignal,
  ): Promise<MarkitdownBatchResult> {
    assertLocalPaths(sources, this.config.allowedReadRoots)
    return this.transport.convertBatch(sources, options?.ocr, signal, options?.timeoutMs)
  }

  async health(signal?: AbortSignal): Promise<MarkitdownHealth> {
    return this.transport.health(signal)
  }

  /** Public dispose hook for apply()'s ctx.effect cleanup. */
  dispose(): void {
    this.transport.dispose()
  }
}

// ---------------------------------------------------------------------------
// apply — registration point (construction auto-provides via super(ctx, key))
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Config schema (Schemastery) — must stay consistent with cordis.yml config block
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Config schema (Schemastery) — must stay consistent with cordis.yml config block
//
// The validator MUST be exported under the exact name `Config`: the loader reads
// `plugin.Config` (vendor/cordis/src/registry.ts:326) and skips validation AND
// default-filling entirely when it is absent (fiber.ts:50-53). Renaming or
// aliasing it silently degrades every default below to `undefined`.
// ---------------------------------------------------------------------------

export interface Config {
  /** Python 解释器绝对路径（隔离 venv） */
  pythonPath: string
  /** vendored 目录绝对路径 */
  vendorPath: string
  /** 传输模式 */
  transportMode: 'collect' | 'interactive'
  /** 单次转换请求的超时毫秒数 */
  timeoutMs: number
  /** bridge 内部并发线程数（interactive 模式） */
  maxConcurrent: number
  /** 本地路径白名单根目录；空数组=拒绝所有本地路径（Fail-Closed） */
  allowedReadRoots: string[]
  /** 崩溃后惰性重启（仅 interactive 模式，且仅一次） */
  restartOnCrash: boolean
  /** collect 模式 stdout 收集字节上限 */
  collectStdoutBytes: number
  /** collect 模式 stderr 诊断尾巴字节上限 */
  collectStderrBytes: number
  /** 子进程终止宽限期（spec.graceMs） */
  terminateGraceMs: number
  /** health 探测的超时毫秒数（两种模式共用） */
  healthTimeoutMs: number
  /** interactive 模式 init 握手超时毫秒数 */
  handshakeTimeoutMs: number
  /** init 握手校验的 vendor 版本锚点 */
  expectedVendorVersion: string
  /** 追加环境变量（合并到净化父环境基线） */
  workerEnv: Record<string, string>
}

export const Config = Schema.object({
  pythonPath: Schema.string().required().description('Python 解释器绝对路径（隔离 venv）'),
  vendorPath: Schema.string().required().description('vendored 目录绝对路径'),
  transportMode: Schema.union(['collect', 'interactive']).default('collect').description('传输模式'),
  timeoutMs: Schema.number().default(120000).description('单次转换请求的超时毫秒数'),
  maxConcurrent: Schema.number().default(4).description('bridge 内部并发线程数（interactive 模式）'),
  allowedReadRoots: Schema.array(String).default([]).description('本地路径白名单根目录；空数组=拒绝所有本地路径（Fail-Closed）'),
  restartOnCrash: Schema.boolean().default(true).description('崩溃后惰性重启（interactive 模式，仅一次）'),
  collectStdoutBytes: Schema.number().default(33554432).description('collect 模式 stdout 收集字节上限'),
  collectStderrBytes: Schema.number().default(16384).description('collect 模式 stderr 诊断尾巴字节上限'),
  terminateGraceMs: Schema.number().default(1000).description('子进程终止宽限期毫秒数'),
  healthTimeoutMs: Schema.number().default(15000).description('health 探测超时毫秒数'),
  handshakeTimeoutMs: Schema.number().default(10000).description('interactive 模式 init 握手超时毫秒数'),
  expectedVendorVersion: Schema.string().default('').description('init 握手校验的 vendor 版本锚点'),
  workerEnv: Schema.dict(String).default({}).description('追加环境变量（合并到净化父环境基线）'),
})

export function apply(ctx: Context, config: Config) {
  if (!config.pythonPath) {
    // Fail loud at mount time rather than PENDING/odd runtime behavior later.
    throw new Error('dsh-markitdown-worker: config.pythonPath is required (isolated venv interpreter)')
  }
  if (!config.vendorPath) {
    throw new Error('dsh-markitdown-worker: config.vendorPath is required (vendor/ directory)')
  }
  if (config.transportMode !== 'collect' && config.transportMode !== 'interactive') {
    throw new Error('dsh-markitdown-worker: config.transportMode must be "collect" or "interactive"')
  }

  // Construction auto-provides on ctx.markitdown via super(ctx, 'markitdown') in
  // the abstract base — no manual assignment (same-key second provide() throws).
  const service = new WorkerMarkitdownService(ctx, config)

  // Fiber-bound cleanup: worker process (interactive mode) dies on unload and
  // pending requests reject — zero residual side effects.
  ctx.effect(() => {
    return () => service.dispose()
  })
}

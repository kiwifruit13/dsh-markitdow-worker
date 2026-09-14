/**
 * Definition package for the `ctx.markitdown` capability seam.
 *
 * Structural invariants (约束/00-总纲/06-插件编写):
 *  - This package exports ONLY the abstract service class, types, and typed error
 *    constructors. It must never import a concrete provider implementation.
 *  - Consumers depend on this package exclusively; providers inherit the abstract
 *    class. Both arrows point up, zero lateral arrows.
 *  - Every payload crossing this seam is lossless JSON (no undefined, NaN, Infinity,
 *    Map/Set/Class instances) — the host-client RPC and stdio bridge both enforce it.
 */
import { Service, type Context } from '@deepseek-ai/cordis'
// Source-verified (Step 6b): HarnessError lives in @deepseek-ai/dsh-llm (re-exported
// from the main entry); there is NO '@deepseek-ai/dsh-error' package — the 约束 doc's
// import example is outdated. Constructor order is (message, code).
import { HarnessError } from '@deepseek-ai/dsh-llm'

// ---------------------------------------------------------------------------
// Types (lossless JSON only)
// ---------------------------------------------------------------------------

/** Per-request OCR override. When absent, OCR stays disabled for this call. */
export interface MarkitdownOcrOptions {
  /** OpenAI-compatible endpoint base URL (bridged from ctx.credentials, not ctx.llm direct). */
  baseUrl: string
  /** API key for the OCR endpoint — sourced from ctx.credentials, never hardcoded. */
  apiKey: string
  /** Vision-capable model name, e.g. 'gpt-4o'. */
  model: string
  /** Optional prompt override for text extraction. */
  prompt?: string
}

export interface MarkitdownConvertOptions {
  /** Enable OCR-enhanced converters for this call (priority -1.0 replaces built-ins). */
  ocr?: MarkitdownOcrOptions
  /** Per-request timeout in milliseconds. Falls back to provider config when omitted. */
  timeoutMs?: number
}

export type MarkitdownResultMeta = {
  /** Character count of the produced markdown. */
  chars: number
  /** The source path/URI exactly as submitted. */
  source: string
}

export type MarkitdownResult = {
  /** Converted markdown text (normalized: trailing spaces stripped, 3+ newlines collapsed). */
  markdown: string
  /**
   * Document title extracted by the converter.
   *
   * The bridge OMITS this key entirely when the upstream converter reports `None`.
   * It must never arrive as JSON `null`: the DSH output-schema validator rejects
   * `null` against `type: 'string'` (json-schema.ts:607) while skipping absent
   * keys (json-schema.ts:569), so "absent" is the only lossless encoding of
   * "no title". Consumers must treat this as string-or-absent, never null.
   */
  title?: string
  meta: MarkitdownResultMeta
}

export type MarkitdownBatchItem =
  | ({ source: string } & MarkitdownResult)
  | { source: string; error: { code: string; message: string } }

export type MarkitdownBatchResult = {
  items: MarkitdownBatchItem[]
}

export interface MarkitdownHealth {
  ok: boolean
  pending: number
}

/** Payload for the `markitdown/converted` emit event. Lossless JSON only. */
export type MarkitdownConvertedPayload = {
  source: string
  chars: number
  title?: string
  /** Whether OCR-enhanced converters produced this result. */
  ocr: boolean
}

// ---------------------------------------------------------------------------
// Typed error hierarchy (Fail-Closed carrier)
// ---------------------------------------------------------------------------

/** Base class — every markitdown failure is detectable via `e.code`, never silent. */
export class MarkitdownError extends HarnessError {
  constructor(message: string, code: string) {
    // HarnessError signature is (message, code) — source-verified order.
    super(message, code)
  }
}

/** The seam has no active provider, or the worker/bridge failed version handshake. */
export class MarkitdownUnavailableError extends MarkitdownError {
  static readonly code = 'MARKITDOWN_UNAVAILABLE'
  constructor(message = 'No markitdown backend is available') {
    super(message, MarkitdownUnavailableError.code)
  }
}

/** A Python-side optional dependency is missing (e.g. pymupdf for OCR pdf path). */
export class MarkitdownDependencyError extends MarkitdownError {
  static readonly code = 'MARKITDOWN_DEPENDENCY'
  constructor(message: string) {
    super(message, MarkitdownDependencyError.code)
  }
}

/** The source format has no accepting converter. */
export class MarkitdownUnsupportedFormatError extends MarkitdownError {
  static readonly code = 'MARKITDOWN_UNSUPPORTED_FORMAT'
  constructor(message: string) {
    super(message, MarkitdownUnsupportedFormatError.code)
  }
}

/** The format was recognized but conversion failed (carries per-attempt detail). */
export class MarkitdownConversionFailedError extends MarkitdownError {
  static readonly code = 'MARKITDOWN_CONVERSION_FAILED'
  constructor(
    message: string,
    /** Structured attempts detail, lossless JSON. */
    readonly attempts?: Array<{ converter: string; message: string }>,
  ) {
    super(message, MarkitdownConversionFailedError.code)
  }
}

// ---------------------------------------------------------------------------
// Abstract service + Context/Events extension
// ---------------------------------------------------------------------------

export abstract class MarkitdownService extends Service {
  constructor(ctx: Context) {
    // Runtime-level key binding — MUST match the `markitdown` key declared in the
    // `declare module` Context extension below (double declaration = seam identity).
    // Construction via super() auto-provides on ctx: provider `apply` only needs
    // `new WorkerMarkitdownService(ctx, config)`, no manual assignment.
    super(ctx, 'markitdown')
  }

  /**
   * Convert one local path or URI (http/https/file/data) to markdown.
   * `signal` must abort the in-flight request including any bridge round-trip.
   */
  abstract convert(
    source: string,
    options?: MarkitdownConvertOptions,
    signal?: AbortSignal,
  ): Promise<MarkitdownResult>

  /** Convert many sources. Per-item errors are contained; the batch itself never rejects. */
  abstract convertBatch(
    sources: string[],
    options?: MarkitdownConvertOptions,
    signal?: AbortSignal,
  ): Promise<MarkitdownBatchResult>

  /** Probe worker liveness. Rejects with MarkitdownUnavailableError when unreachable. */
  abstract health(signal?: AbortSignal): Promise<MarkitdownHealth>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    markitdown: MarkitdownService
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Broadcast (emit) after each successful conversion. Observers only — no decision.
     * @mode emit
     */
    'markitdown/converted': (payload: MarkitdownConvertedPayload) => void
  }
}

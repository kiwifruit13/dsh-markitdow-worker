/**
 * Consumer tools for the `ctx.markitdown` seam.
 *
 * Contract obligations (知识库 five-layer tool checklist):
 *  - inject declares EVERY ctx service consumed here (`credentials` included — a missing
 *    credentials provider yields PENDING, which is the documented diagnostic path).
 *  - exec.signal is forwarded into the seam (abort → cooperative bridge cancel).
 *  - output.render is the model-visible surface; truncation is applied here, never as
 *    silent UI formatting. presentationMeta + card rendering is the UI surface only.
 *  - No native timers, no I/O in presentation functions.
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
// Source-verified (dsh-llm message.d.ts:180): inject() takes an identified
// UserMessage — createUserMessage mints id/role and freezes.
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { MarkitdownDependencyError } from '@kiwifruit/dsh-markitdown'
import type {
  MarkitdownResult,
  MarkitdownBatchResult,
  MarkitdownOcrOptions,
} from '@kiwifruit/dsh-markitdown'

export const name = 'dsh-tool-markitdown'
// Conditional dependencies (credentials) are resolved via ctx.inject() inside apply —
// declaring them here would PENDING the whole tool when the provider is absent even
// though OCR is only an optional path.
export const inject = ['tools', 'markitdown'] as const

/** Source-verified view of CredentialProvider.resolve (packages/credentials/credentials/src/index.ts:183). */
interface CredentialsLike {
  resolve(ref: ReturnType<typeof credentialRef>): Promise<{ value: string; source: string } | undefined>
}

// ---------------------------------------------------------------------------
// Config (Schemastery schema + TS interface; apply receives validated config)
// ---------------------------------------------------------------------------

export interface Config {
  /** 单条工具结果中暴露给模型的最大字符数 */
  maxOutputChars: number
  /** 是否默认启用 OCR 增强转换器 */
  ocrEnabledByDefault: boolean
  /** OCR 端点 base URL（OpenAI 兼容）；留空则禁用 OCR 路径 */
  ocrBaseUrl: string
  /** OCR 视觉模型名 */
  ocrModel: string
  /** ctx.credentials 中存放 OCR API key 的凭证键名 */
  ocrCredentialKey: string
}

export const Config = Schema.object({
  maxOutputChars: Schema.number().default(50000).description('单条工具结果中暴露给模型的最大字符数'),
  ocrEnabledByDefault: Schema.boolean().default(false).description('是否默认启用 OCR 增强转换器'),
  ocrBaseUrl: Schema.string().default('').description('OCR 端点 base URL（OpenAI 兼容）；留空则禁用 OCR 路径'),
  ocrModel: Schema.string().default('').description('OCR 视觉模型名'),
  ocrCredentialKey: Schema.string().default('markitdown/ocr').description('ctx.credentials 中存放 OCR API key 的凭证键名'),
})

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function truncateForModel(markdown: string, maxChars: number): string {
  if (markdown.length <= maxChars) return markdown
  return (
    markdown.slice(0, maxChars) +
    `\n\n[markitdown: output truncated at ${maxChars} of ${markdown.length} characters]`
  )
}

interface CanonicalConvert {
  markdown: string
  title?: string
  meta: { chars: number; source: string }
}

function renderConvert(value: CanonicalConvert, maxChars: number): string {
  const body = truncateForModel(value.markdown, maxChars)
  return value.title ? `# ${value.title}\n\n${body}` : body
}

/** UI-only preview (generic card content); never enters the model result. */
function uiPreview(markdown: string): string {
  return markdown.length > 400 ? markdown.slice(0, 400) + '…' : markdown
}

// ---------------------------------------------------------------------------
// apply — tool registration (registration is itself a reversible effect)
// ---------------------------------------------------------------------------

export function apply(ctx: Context, config: Config) {
  const maxChars = config.maxOutputChars

  // Conditional dependency: credentials service is captured when (and only when) its
  // provider is present. OCR calls fail Fail-Closed if it never becomes available.
  let credentials: CredentialsLike | undefined
  ctx.inject(['credentials'], (credCtx: Context) => {
    credentials = (credCtx as unknown as { credentials: CredentialsLike }).credentials
  })

  /** Resolve OCR options at call time: config gate + credential lookup. */
  async function resolveOcr(useOcr: boolean | undefined): Promise<MarkitdownOcrOptions | undefined> {
    const explicit = useOcr === true
    const wanted = useOcr ?? config.ocrEnabledByDefault
    if (!wanted) return undefined
    if (!config.ocrBaseUrl || !config.ocrModel) {
      // Fail-Closed (约束/01-架构认知/17-fail-closed安全模型详解): an EXPLICIT
      // `ocr: true` with no endpoint configured must be a detectable error. Silently
      // degrading to a non-OCR conversion would let the model believe it received
      // OCR output. A merely default-enabled-but-unconfigured OCR stays silently
      // closed — that is the configured intent, not a downgrade.
      if (!explicit) return undefined
      throw new MarkitdownDependencyError(
        'OCR was requested but ocrBaseUrl/ocrModel are not configured — set them in the profile patch',
      )
    }
    if (!credentials) {
      // Fail-Closed: OCR was requested but no credentials provider exists — reject
      // with a typed error instead of silently degrading to non-OCR conversion.
      throw new MarkitdownDependencyError('OCR requested but the credentials service is unavailable')
    }
    // Source-verified: resolve(credentialRef) → {value, source} | undefined; an
    // absent/blank credential is `undefined` — treated as unconfigured (Fail-Closed).
    const resolved = await credentials.resolve(credentialRef(config.ocrCredentialKey))
    if (!resolved) {
      throw new MarkitdownDependencyError(`credential '${config.ocrCredentialKey}' is not configured`)
    }
    const apiKey = resolved.value
    return { baseUrl: config.ocrBaseUrl, apiKey, model: config.ocrModel }
  }

  ctx.tools.register(
    defineTool({
      name: 'markitdown_convert',
      description:
        'Convert a local file path or an http/https/file/data URI (PDF, DOCX, PPTX, XLSX, HTML, images and more) to Markdown text.',
      parameters: {
        source: { type: 'string', required: true, description: 'Local path or URI of the document to convert' },
        ocr: { type: 'boolean', description: 'Enable OCR-enhanced conversion for scanned documents (requires ocrBaseUrl/ocrModel to be configured; fails closed otherwise)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            markdown: { type: 'string' },
            // Optionality in the value-schema DSL = OMIT `required` (which may only
            // ever be `true`). There is no `optional` key — see schema.ts:181
            // ANNOTATION_KEYS + schema.ts:293 `required must be true when present`.
            title: { type: 'string' },
            meta: {
              type: 'object',
              additionalProperties: false,
              properties: { chars: { type: 'number' }, source: { type: 'string' } },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderConvert(value as CanonicalConvert, maxChars) }],
        presentationMeta: (args, value) => {
          const v = value as CanonicalConvert
          return {
            card: 'generic' as const,
            title: v.meta.source,
            content: uiPreview(v.markdown),
            locations: [{ path: v.meta.source }],
          }
        },
      },
      async execute(args, exec): Promise<CanonicalConvert> {
        const ocr = await resolveOcr(args.ocr)
        // Signal forwarding: abort reaches the bridge as a cooperative cancel.
        const result: MarkitdownResult = await ctx.markitdown.convert(args.source, { ocr }, exec.signal)
        // `title` is `string | undefined` by contract, but upstream Python yields
        // `None`; an older bridge could still hand us `null`. The output-schema
        // validator rejects `null` for `type: 'string'` (json-schema.ts:607) yet
        // SKIPS absent keys (json-schema.ts:569) — so only emit the key when it is
        // genuinely a string, and omit it otherwise.
        return typeof result.title === 'string'
          ? { markdown: result.markdown, title: result.title, meta: result.meta }
          : { markdown: result.markdown, meta: result.meta }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'markitdown_convert_batch',
      description:
        'Convert multiple documents to Markdown in one call (max 20). Per-item failures are contained and reported per source.',
      parameters: {
        sources: { type: 'array', items: { type: 'string' }, required: true, description: 'Paths or URIs to convert' },
        ocr: { type: 'boolean', description: 'Enable OCR-enhanced conversion for scanned documents (requires ocrBaseUrl/ocrModel to be configured; fails closed otherwise)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            items: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
        render: (_args, value) => {
          const batch = value as MarkitdownBatchResult
          const lines = batch.items.map((item) => {
            if ('error' in item) {
              return `- ${item.source}: ERROR ${item.error.code} — ${item.error.message}`
            }
            return `- ${item.source}: ${item.meta.chars} chars\n\n${truncateForModel(item.markdown, maxChars)}`
          })
          return [{ type: 'text', text: lines.join('\n\n') }]
        },
        presentationMeta: (_args, value) => {
          const batch = value as MarkitdownBatchResult
          return {
            card: 'generic' as const,
            title: `markitdown batch (${batch.items.length} items)`,
            content: batch.items
              .map((i) => ('error' in i ? `FAIL ${i.source}` : `OK   ${i.source}`))
              .join('\n'),
          }
        },
      },
      async execute(args, exec): Promise<MarkitdownBatchResult> {
        if (args.sources.length > 20) {
          throw new Error('markitdown_convert_batch: at most 20 sources per call')
        }
        const ocr = await resolveOcr(args.ocr)
        const result = await ctx.markitdown.convertBatch(args.sources, { ocr }, exec.signal)
        // Result-attached instruction (source-verified: packages/core/tools/src/index.ts:404
        // `deferContext(context: UserMessage): void` — the loop appends it only AFTER this
        // execution's `tool/result`, so the model sees the result before the notice, and no
        // disposed-agent guard is needed).
        exec.deferContext(
          createUserMessage({
            content: [
              {
                type: 'text',
                text: `markitdown batch finished: ${result.items.filter((i) => !('error' in i)).length}/${result.items.length} succeeded`,
              },
            ],
            source: { kind: 'plugin', plugin: 'dsh-tool-markitdown' },
          }),
        )
        return result
      },
    }),
  )
}

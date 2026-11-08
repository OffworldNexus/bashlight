/**
 * The models the benchmark runs, with the metadata the report needs.
 *
 * Every model carries a **tier** used to group it in the headline charts and a
 * **display name**, plus an output price that orders models small → large. To
 * classify a new model:
 *
 * - `small` — a cheap, fast mini/nano-class model. These are the ones we most
 *   expect bashlight to help, because they discover the project toolchain least
 *   reliably.
 * - `flash` — a cheap-but-capable flash-class model.
 *
 * Keep `outputPricePerMTok` in sync with OpenRouter (USD per million output
 * tokens); the completion chart orders models by it, smallest first.
 */

export type Tier = "small" | "flash";

export interface ModelConfig {
    /** The OpenCode model id, `openrouter/<vendor>/<model>`. */
    readonly id: string;
    /** The short name shown in charts and tables. */
    readonly display: string;
    readonly tier: Tier;
    /** Output price in USD per million tokens; the small → large ordering key. */
    readonly outputPricePerMTok: number;
}

/** The default model set, cheapest (smallest) first. */
export const MODELS: readonly ModelConfig[] = [
    {
        id: "openrouter/openai/gpt-5-nano",
        display: "gpt-5-nano",
        tier: "small",
        outputPricePerMTok: 0.4,
    },
    {
        id: "openrouter/anthropic/claude-haiku-5.5",
        display: "claude-haiku-5.5",
        tier: "flash",
        outputPricePerMTok: 0.5,
    },
    {
        id: "openrouter/deepseek/deepseek-v4.1-flash",
        display: "deepseek-v4.1-flash",
        tier: "flash",
        outputPricePerMTok: 0.65,
    },
];

/** The ids of {@link MODELS}, in the default order. */
export const DEFAULT_MODEL_IDS: readonly string[] = MODELS.map((model) => model.id);

/** A model id without its provider prefixes, e.g. `deepseek-v4.1-flash`. */
export function shortModel(model: string): string {
    const parts = model.split("/");
    return parts[parts.length - 1] ?? model;
}

/**
 * The config for a model id. An unknown model is treated as a larger
 * (`flash`) model and ordered last, so a new model still renders.
 */
export function modelConfig(id: string): ModelConfig {
    return (
        MODELS.find((model) => model.id === id) ?? {
            id,
            display: shortModel(id),
            tier: "flash",
            outputPricePerMTok: Number.POSITIVE_INFINITY,
        }
    );
}

/** The short display name for a model id. */
export function displayName(id: string): string {
    return modelConfig(id).display;
}

/** The tier for a model id. */
export function tierOf(id: string): Tier {
    return modelConfig(id).tier;
}

/** Model ids ordered small → large by output price, then by name. */
export function orderBySize(ids: readonly string[]): readonly string[] {
    return [...ids].sort((left, right) => {
        const byPrice =
            modelConfig(left).outputPricePerMTok -
            modelConfig(right).outputPricePerMTok;
        return byPrice !== 0 ? byPrice : left.localeCompare(right);
    });
}

/** Model ids in one tier, ordered small → large. */
export function modelsInTier(ids: readonly string[], tier: Tier): readonly string[] {
    return orderBySize(ids.filter((id) => tierOf(id) === tier));
}

"use client";

import { useMemo } from "react";
import { CircleAlert, Cpu, RefreshCw } from "lucide-react";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { useModels } from "@/hooks/useModels";
import { DEFAULT_MODELS, MODEL_ID_PATTERN, MODEL_STAGES, type ModelStage } from "@/lib/constants";
import type { ModelOption } from "@/lib/types";

export function formatContextLength(tokens: number | null): string {
  if (!tokens) return "";
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M ctx`;
  return `${Math.round(tokens / 1_000)}K ctx`;
}

function formatPrice(value: number | null): string {
  if (value === null) return "?";
  if (value === 0) return "0";
  if (value < 0.01) return String(Number(value.toPrecision(1)));
  return String(Number(value.toFixed(value < 1 ? 3 : 2)));
}

export function formatPricing(model: Pick<ModelOption, "promptPrice" | "completionPrice">): string {
  if (model.promptPrice === null && model.completionPrice === null) return "";
  if (model.promptPrice === 0 && model.completionPrice === 0) return "Free";
  return `$${formatPrice(model.promptPrice)}/$${formatPrice(model.completionPrice)}`;
}

type ModelPickerProps = {
  value: string;
  onChange: (model: string) => void;
  stage: ModelStage;
  /** Workspace default for the stage, shown first in the list. */
  defaultModel?: string;
  size?: "sm" | "md";
  align?: "start" | "end";
  side?: "bottom" | "top";
  disabled?: boolean;
  triggerClassName?: string;
};

export function ModelPicker({ value, onChange, stage, defaultModel, size = "md", align = "start", side = "bottom", disabled, triggerClassName = "" }: ModelPickerProps) {
  const { data, error, isLoading, mutate } = useModels();
  const stageInfo = MODEL_STAGES[stage];
  const workspaceDefault = defaultModel ?? DEFAULT_MODELS[stage];

  const options = useMemo<ComboboxOption[]>(() => {
    const models = data?.models ?? [];
    const byId = new Map(models.map((model) => [model.id, model]));
    const suggestedIds = [...new Set([value, workspaceDefault, DEFAULT_MODELS[stage]].filter(Boolean))];

    const toOption = (model: ModelOption | undefined, id: string, group: string): ComboboxOption => {
      const pricing = model ? formatPricing(model) : "";
      const context = model ? formatContextLength(model.contextLength) : "";
      const warning = !model && models.length ? "Not in the OpenRouter catalog · " : stageInfo.structured && model && !model.structuredOutput ? "May not support structured output · " : "";
      return {
        value: id,
        label: model?.name ?? id,
        description: `${warning}${id === workspaceDefault ? "Workspace default · " : ""}${id}`,
        meta: size === "sm" ? pricing : [context, pricing].filter(Boolean).join(" · "),
        group,
        keywords: model ? `${model.provider} ${model.description}` : "",
      };
    };

    const suggested = suggestedIds.map((id) => toOption(byId.get(id), id, "Suggested"));
    const rest = models.filter((model) => !suggestedIds.includes(model.id)).map((model) => toOption(model, model.id, model.provider));
    return [...suggested, ...rest];
  }, [data?.models, size, stage, stageInfo.structured, value, workspaceDefault]);

  const selectedModel = data?.models.find((model) => model.id === value);
  const unavailable = Boolean(data?.models.length) && !selectedModel;

  return (
    <Combobox
      label={`${stageInfo.label} model`}
      value={value}
      options={options}
      onChange={onChange}
      size={size}
      align={align}
      side={side}
      disabled={disabled}
      loading={isLoading}
      error={error ? `${error.message}` : undefined}
      searchPlaceholder="Search models by name, provider, or ID…"
      emptyText="No models match. Type a full ID like provider/model to use it anyway."
      allowCustom={(query) => MODEL_ID_PATTERN.test(query)}
      customLabel={(query) => `Use model ID “${query}”`}
      icon={unavailable
        ? <CircleAlert size={size === "sm" ? 13 : 15} className="shrink-0 text-[var(--warning)]" aria-label="Model not found in the OpenRouter catalog" />
        : <Cpu size={size === "sm" ? 13 : 15} className="shrink-0 text-[var(--accent)]" />}
      title={unavailable ? `${value} is not in the current OpenRouter catalog and may fail. Choose another model.` : undefined}
      triggerClassName={`${unavailable ? "!border-[var(--warning)]/50" : ""} ${triggerClassName}`}
      panelClassName={size === "sm" ? "w-[min(24rem,calc(100vw-2rem))]" : "w-[min(30rem,calc(100vw-2rem))]"}
      renderValue={() => (
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate">{selectedModel?.name ?? value}</span>
          {size === "md" && selectedModel && <span className="hidden truncate text-[11px] text-[var(--muted)] sm:inline">{selectedModel.provider}</span>}
        </span>
      )}
      footer={
        <span className="flex items-center justify-between gap-3">
          <span>{stageInfo.structured ? "Needs structured output (JSON) support." : "Prices are USD per 1M input/output tokens."}</span>
          <button type="button" onClick={() => void mutate(fetch("/api/models?refresh=1").then(async (response) => response.ok ? response.json() : Promise.reject(new Error("Could not refresh models."))), { revalidate: false })} className="inline-flex shrink-0 items-center gap-1 text-[var(--muted)] hover:text-[var(--ink)]">
            <RefreshCw size={11} /> Refresh
          </button>
        </span>
      }
    />
  );
}

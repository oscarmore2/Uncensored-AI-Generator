"use client";

import {
  DEFAULT_UNDRESS_ADVANCED,
  UNDRESS_BODY_DECORATION,
  UNDRESS_BODY_TYPE,
  UNDRESS_BREAST_SHAPE,
  UNDRESS_BREAST_SIZE,
  UNDRESS_FOOTWEAR,
  UNDRESS_LEG_ENHANCE,
  UNDRESS_LOWER_WEAR,
  UNDRESS_NIPPLE_SIZE,
  UNDRESS_PUBIC_TYPE,
  UNDRESS_UNDERWEAR_COLORS,
  showsBreastDetails,
  showsUnderwearColor,
  type UndressAdvancedOptions,
} from "@/lib/undress-options";

type TFn = (key: string) => string;

function OptionChips<T extends string>({
  label,
  values,
  value,
  onChange,
  labelOf,
}: {
  label: string;
  values: readonly T[];
  value: T;
  onChange: (next: T) => void;
  labelOf: (v: T) => string;
}) {
  return (
    <div>
      <label className="text-xs text-ink-muted block mb-1.5">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => {
          const active = value === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={`px-3 py-1.5 rounded-xl border text-xs transition-colors ${
                active
                  ? "bg-orange-600/20 border-orange-500 text-orange-700"
                  : "bg-black/[0.03] border-line text-ink-muted hover:border-line-strong"
              }`}
            >
              {labelOf(v)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** VIP2 穿着/身材高级选项：仅女性脱衣模式展示 */
export function UndressAdvancedPanel({
  value,
  onChange,
  t,
}: {
  value: UndressAdvancedOptions;
  onChange: (next: UndressAdvancedOptions) => void;
  t: TFn;
}) {
  function patch(partial: Partial<UndressAdvancedOptions>) {
    const next = { ...value, ...partial };
    if (!showsUnderwearColor(next.lower_wear)) {
      next.underwear_color = DEFAULT_UNDRESS_ADVANCED.underwear_color;
    }
    if (!showsBreastDetails(next.breast_size)) {
      next.breast_shape = "default";
      next.nipple_size = "default";
    }
    onChange(next);
  }

  return (
    <div className="mb-5 space-y-4 rounded-2xl border border-line bg-black/[0.03] p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-orange-700">{t("undressAdvancedTitle")}</span>
        <span className="text-[10px] px-1.5 py-px rounded bg-amber-500/20 text-amber-800">VIP2</span>
      </div>
      <p className="text-[11px] text-ink-subtle leading-relaxed">{t("undressAdvancedHint")}</p>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
          {t("undressSections.wear")}
        </h3>
        <OptionChips
          label={t("undressFields.lower_wear")}
          values={UNDRESS_LOWER_WEAR}
          value={value.lower_wear}
          onChange={(lower_wear) => patch({ lower_wear })}
          labelOf={(v) => t(`undressOpts.lower_wear.${v}`)}
        />
        {showsUnderwearColor(value.lower_wear) && (
          <OptionChips
            label={t("undressFields.underwear_color")}
            values={UNDRESS_UNDERWEAR_COLORS}
            value={value.underwear_color}
            onChange={(underwear_color) => patch({ underwear_color })}
            labelOf={(v) => t(`undressOpts.underwear_color.${v}`)}
          />
        )}
        <OptionChips
          label={t("undressFields.footwear")}
          values={UNDRESS_FOOTWEAR}
          value={value.footwear}
          onChange={(footwear) => patch({ footwear })}
          labelOf={(v) => t(`undressOpts.footwear.${v}`)}
        />
      </section>

      <section className="space-y-3 pt-2 border-t border-line">
        <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
          {t("undressSections.body")}
        </h3>
        <OptionChips
          label={t("undressFields.breast_size")}
          values={UNDRESS_BREAST_SIZE}
          value={value.breast_size}
          onChange={(breast_size) => patch({ breast_size })}
          labelOf={(v) => t(`undressOpts.breast_size.${v}`)}
        />
        {showsBreastDetails(value.breast_size) && (
          <>
            <OptionChips
              label={t("undressFields.breast_shape")}
              values={UNDRESS_BREAST_SHAPE}
              value={value.breast_shape}
              onChange={(breast_shape) => patch({ breast_shape })}
              labelOf={(v) => t(`undressOpts.breast_shape.${v}`)}
            />
            <OptionChips
              label={t("undressFields.nipple_size")}
              values={UNDRESS_NIPPLE_SIZE}
              value={value.nipple_size}
              onChange={(nipple_size) => patch({ nipple_size })}
              labelOf={(v) => t(`undressOpts.nipple_size.${v}`)}
            />
          </>
        )}
        <OptionChips
          label={t("undressFields.body_decoration")}
          values={UNDRESS_BODY_DECORATION}
          value={value.body_decoration}
          onChange={(body_decoration) => patch({ body_decoration })}
          labelOf={(v) => t(`undressOpts.body_decoration.${v}`)}
        />
        <OptionChips
          label={t("undressFields.pubic_type")}
          values={UNDRESS_PUBIC_TYPE}
          value={value.pubic_type}
          onChange={(pubic_type) => patch({ pubic_type })}
          labelOf={(v) => t(`undressOpts.pubic_type.${v}`)}
        />
        <OptionChips
          label={t("undressFields.body_type")}
          values={UNDRESS_BODY_TYPE}
          value={value.body_type}
          onChange={(body_type) => patch({ body_type })}
          labelOf={(v) => t(`undressOpts.body_type.${v}`)}
        />
        <OptionChips
          label={t("undressFields.leg_enhance")}
          values={UNDRESS_LEG_ENHANCE}
          value={value.leg_enhance}
          onChange={(leg_enhance) => patch({ leg_enhance })}
          labelOf={(v) => t(`undressOpts.leg_enhance.${v}`)}
        />
      </section>
    </div>
  );
}
